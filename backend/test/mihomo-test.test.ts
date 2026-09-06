import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import { withDummyProxies } from '../src/mihomo/dummyProxies.js'
import { MihomoService } from '../src/mihomo/service.js'
import type { SpawnRunner } from '../src/proc/spawn.js'
import { buildServer } from '../src/server.js'
import { loginCookie, makeTestConfig } from './helpers.js'
import { makeStubRemnawave } from './stub-remnawave.js'

const FIXTURE_NAMES = ['default', 'simple', 'bundle'] as const

/**
 * Копии данных из frontend/test/fixtures/mihomo/*.yaml — настоящие шаблоны из
 * remnawave/templates, а не синтетика в 5-10 строк. Общих файлов между workspace
 * быть не должно, поэтому это дублирование ДАННЫХ, а копия дешевле непроверенного
 * риска: главный риск фичи («подбор фиктивных прокси фиксируется тестом на всех
 * трёх фикстурах») не был закрыт ни одним тестом на настоящем документе.
 */
function realMihomoFixture(name: (typeof FIXTURE_NAMES)[number]): string {
  return readFileSync(new URL(`./fixtures/mihomo/${name}.yaml`, import.meta.url), 'utf8')
}

const TEMPLATE = `proxies: # LEAVE THIS LINE!

proxy-groups:
  - name: VPN
    type: select
    proxies: # LEAVE THIS LINE!

rules:
  - MATCH,VPN
`

describe('подстановка фиктивных прокси', () => {
  it('заполняет корневой список и группы с маркером', () => {
    const config = parse(withDummyProxies(TEMPLATE)) as {
      proxies: { name: string }[]
      'proxy-groups': { name: string; proxies: string[] }[]
    }
    expect(config.proxies.length).toBeGreaterThan(0)
    expect(config['proxy-groups'][0]!.proxies).toContain(config.proxies[0]!.name)
  })

  it('заполняет payload inline-провайдеров — пустой ядро не примет', () => {
    const text = 'proxy-providers:\n  ru:\n    type: inline\n    payload:\nrules:\n  - MATCH,DIRECT\n'
    const config = parse(withDummyProxies(text)) as {
      'proxy-providers': Record<string, { payload: unknown[] }>
    }
    expect(config['proxy-providers'].ru!.payload.length).toBeGreaterThan(0)
  })

  it('группу с include-proxies: false не трогает', () => {
    const text =
      'proxy-groups:\n  - name: a\n    remnawave:\n      include-proxies: false\n    proxies:\n      - DIRECT\nrules:\n  - MATCH,a\n'
    const config = parse(withDummyProxies(text)) as { 'proxy-groups': { proxies: string[] }[] }
    expect(config['proxy-groups'][0]!.proxies).toEqual(['DIRECT'])
  })

  it('ключи remnawave снимаются — ядро о них не знает', () => {
    const config = parse(withDummyProxies('remnawave:\n  includeHiddenHosts: false\nrules:\n  - MATCH,DIRECT\n')) as Record<string, unknown>
    expect(config.remnawave).toBeUndefined()
  })
})

describe('проверка ядром', () => {
  const run = (outcome: Awaited<ReturnType<SpawnRunner>>): SpawnRunner => vi.fn(async () => outcome)

  it('нет бинаря — инструмент недоступен, а не ошибка', async () => {
    const error = Object.assign(new Error('нет файла'), { code: 'ENOENT' })
    const service = new MihomoService('mihomo', '/tmp', run({ code: null, output: '', error }))
    const res = await service.test(TEMPLATE)
    expect(res).toEqual({ available: false, ok: false, errors: [] })
  })

  it('нулевой код возврата — конфиг принят', async () => {
    const service = new MihomoService('mihomo', '/tmp', run({ code: 0, output: 'test is successful' }))
    const res = await service.test(TEMPLATE)
    expect(res.ok).toBe(true)
    expect(res.available).toBe(true)
  })

  it('ненулевой код — строки вывода становятся ошибками', async () => {
    const service = new MihomoService(
      'mihomo', '/tmp',
      run({ code: 1, output: 'level=error msg="proxy 0: unsupport proxy type"\n' }),
    )
    const res = await service.test(TEMPLATE)
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toContain('unsupport proxy type')
  })

  it('ядро получает файл с подставленными прокси, а не исходный шаблон', async () => {
    // Отдельный шаблон именно для этой проверки: корневой и групповой ключи
    // remnawave присутствуют по-настоящему (в TEMPLATE выше их нет вовсе, и
    // проверка «ключей нет» была бы верна для любого шаблона без них — в том
    // числе для регрессии, которая вырезала бы само снятие ключей).
    // select-random-proxy — легитимный remnawave-ключ группы (см.
    // frontend/src/entities/mihomo/groups.ts), в отличие от include-proxies
    // он не отключает подстановку маркера, поэтому не мешает соседней проверке.
    const TEMPLATE_WITH_REMNAWAVE = `remnawave:
  includeHiddenHosts: false

proxies: # LEAVE THIS LINE!

proxy-groups:
  - name: VPN
    type: select
    remnawave:
      select-random-proxy: true
    proxies: # LEAVE THIS LINE!

rules:
  - MATCH,VPN
`

    // Раннер замокан, но файл на момент вызова ещё существует (удаление — в
    // finally, уже после возврата раннера): читаем его по переданному пути,
    // чтобы проверить именно содержимое, а не просто наличие флагов -t/-f.
    let written = ''
    const runner = vi.fn(async (_bin: string, args: string[]) => {
      const file = args[args.indexOf('-f') + 1]!
      written = await readFile(file, 'utf8')
      return { code: 0, output: 'ok' }
    })
    const service = new MihomoService('mihomo', '/tmp', runner as unknown as SpawnRunner)
    await service.test(TEMPLATE_WITH_REMNAWAVE)

    const args = (runner.mock.calls[0] as unknown as [string, string[], unknown])[1]
    expect(args).toContain('-t')
    expect(args).toContain('-f')

    const config = parse(written) as {
      proxies: { name: string }[]
      'proxy-groups': { name: string; proxies: string[] }[]
    }
    // Список фиктивных серверов непуст, а группа с маркером получила их имена —
    // без подстановки ядро увидело бы исходный шаблон с дырами и пустым списком
    expect(config.proxies.length).toBeGreaterThan(0)
    expect(config['proxy-groups'][0]!.proxies).toContain(config.proxies[0]!.name)
    // Маркер-комментарий — только приглашение подставить прокси; в файле для
    // ядра его быть не должно, иначе дыра осталась дырой
    expect(written).not.toContain('LEAVE THIS LINE!')
    // Ключи remnawave ядро не знает — они обязаны быть сняты перед записью.
    // Шаблон выше содержит их и в корне, и в группе, поэтому проверка
    // действительно различает «сняты» от «остались»
    expect(written).not.toContain('remnawave')
  })
})

describe('POST /api/tools/mihomo-test на битом YAML', () => {
  it('отвечает 400 с русским текстом, а не 500 движка', async () => {
    const app = await buildServer(makeTestConfig(), { remnawave: makeStubRemnawave() })
    const cookie = await loginCookie(app)
    // Незакрытая квадратная скобка — YAMLParseError бросается до входа в try сервиса
    const broken = Buffer.from('a: [1,2\n', 'utf8').toString('base64')
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/mihomo-test',
      headers: { cookie },
      payload: { encodedTemplateYaml: broken },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/шаблон.*yaml|разобрать.*yaml/i)
    expect(res.json().message).toMatch(/[а-яё]/i) // русский текст, а не английский движка
    await app.close()
  })
})

describe('подстановка фиктивных прокси на настоящих шаблонах remnawave/templates', () => {
  it.each(FIXTURE_NAMES)('%s: не бросает, разбирается, маркеров и remnawave не осталось', (name) => {
    const text = realMihomoFixture(name)
    let substituted = ''
    expect(() => {
      substituted = withDummyProxies(text)
    }).not.toThrow()
    expect(substituted).not.toContain('LEAVE THIS LINE!')
    expect(substituted).not.toContain('remnawave')
    expect(() => parse(substituted)).not.toThrow()
  })

  it.each(FIXTURE_NAMES)('%s: ни одна группа не осталась без кандидатов', (name) => {
    const config = parse(withDummyProxies(realMihomoFixture(name))) as {
      'proxy-groups'?: Record<string, unknown>[]
    }
    const groups = config['proxy-groups'] ?? []
    for (const group of groups) {
      const proxies = Array.isArray(group.proxies) ? group.proxies : []
      const use = Array.isArray(group.use) ? group.use : []
      const includeAll = group['include-all'] === true || group['include-all-proxies'] === true
      const hasCandidates = proxies.length > 0 || use.length > 0 || includeAll
      expect(hasCandidates, `группа «${String(group.name)}» осталась без кандидатов`).toBe(true)
    }
  })
})

// Уровень 2: настоящий запуск ядра. Пропускается, если MIHOMO_BIN не найден в
// системе (обычный случай при локальной разработке без образа) — набор обязан
// оставаться зелёным и на машине без ядра. Проверка бинаря — синхронная и на
// уровне модуля: it.skipIf решает ДО того, как vitest увидит сам тест.
const MIHOMO_BIN = process.env.MIHOMO_BIN ?? 'mihomo'
const hasRealMihomo = (() => {
  try {
    return spawnSync(MIHOMO_BIN, ['-v']).error === undefined
  } catch {
    return false
  }
})()

describe('проверка настоящим ядром mihomo -t (уровень 2, требует бинарь)', () => {
  it.skipIf(!hasRealMihomo).each(FIXTURE_NAMES)('%s принимается ядром', async (name) => {
    const service = new MihomoService(MIHOMO_BIN, tmpdir())
    const res = await service.test(realMihomoFixture(name))
    expect(res.available).toBe(true)
    expect(res.ok, res.errors.join('\n')).toBe(true)
  })
})

// Диагностики документа. Главное правило: имена подставленных панелью хостов
// редактору неизвестны, поэтому «неизвестное имя цели» — предупреждение, а не
// ошибка. Строгая проверка дала бы ложную тревогу на каждом корректном шаблоне.

import { isSeq } from 'yaml'
import type { ValidationIssue, PathParts } from '../xray/config'
import { conflictingKeys, groupGetsHosts } from './inject'
import {
  groupsOf,
  providersOf,
  ruleProvidersOf,
  subRuleEntries,
  subRuleNames,
  type MihomoGroup,
} from './groups'
import type { MihomoDoc } from './parse'
import { resolveTarget } from './resolve'
import { RULE_MODIFIERS, RULE_TYPES, ruleEntriesOf, rulesOf, type RuleEntry } from './rules'

function issue(parts: PathParts, message: string, level: 'error' | 'warning'): ValidationIssue {
  return { parts, path: parts.join('.'), message, level }
}

/**
 * Первая запись на имя. Провайдеры и подсписки — отображения, и диагностика у
 * них адресуется ИМЕНЕМ (`proxy-providers.<имя>`): две записи под одним именем
 * дали бы два одинаковых сообщения с одним и тем же путём, и клик по обоим вёл
 * бы в одно место.
 *
 * Сам дубль ключа при этом не замалчивается — о нём сообщает разбор YAML своей
 * ошибкой («Map keys must be unique») с точным смещением, и сохранение блокирует
 * именно она. Повторять её здесь своими словами значило бы завести второе
 * описание одного факта, которое разошлось бы с первым молча.
 *
 * У групп всё наоборот: `proxy-groups` — СПИСОК, дубль имени там законный YAML,
 * сказать о нём некому, и потому там стоит собственная проверка.
 *
 * Оставляем первую: `resolveTarget` и остальные поиски по имени идут через
 * `some`/`find`, то есть видят тоже первую.
 */
function firstPerName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    out.push(item)
  }
  return out
}

/** Кольцо ссылок между группами: ядро на таком конфиге не поднимется */
function findCycle(groups: MihomoGroup[]): string[] | null {
  const byName = new Map(groups.map((g) => [g.name, g]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const walk = (name: string): string[] | null => {
    if (state.get(name) === 'done') return null
    if (state.get(name) === 'visiting') return [...stack.slice(stack.indexOf(name)), name]
    const group = byName.get(name)
    if (group === undefined) return null
    state.set(name, 'visiting')
    stack.push(name)
    for (const next of group.proxies) {
      const cycle = walk(next)
      if (cycle !== null) return cycle
    }
    stack.pop()
    state.set(name, 'done')
    return null
  }

  for (const group of groups) {
    const cycle = walk(group.name)
    if (cycle !== null) return cycle
  }
  return null
}

export function validateMihomo(md: MihomoDoc): ValidationIssue[] {
  const issues: ValidationIssue[] = [...md.issues]
  const groups = groupsOf(md)
  const providers = firstPerName(providersOf(md))
  const ruleProviders = new Set(ruleProvidersOf(md).map((p) => p.name))
  const subRules = new Set(subRuleNames(md))

  const seen = new Set<string>()
  groups.forEach((group) => {
    const at: PathParts = ['proxy-groups', group.index]
    if (seen.has(group.name)) {
      issues.push(issue([...at, 'name'], `Имя группы «${group.name}» повторяется`, 'error'))
    }
    seen.add(group.name)

    if (!groupGetsHosts(group) && group.proxies.length === 0) {
      issues.push(
        issue(at, `Панель ничего не положит в группу «${group.name}» — она останется пустой`, 'warning'),
      )
    }

    // Симметрично провайдеру ниже: include-proxies: true значим только у
    // proxy-providers (включает подстановку хостов панели в payload); у
    // группы этот ключ ничего не делает — там подстановку регулирует сам
    // факт наличия маркера, а не include-proxies.
    if (group.remnawave.includeProxies === true) {
      issues.push(
        issue(
          [...at, 'remnawave', 'include-proxies'],
          `include-proxies: true допустим только в proxy-providers; у группы «${group.name}» он ничего не значит`,
          'warning',
        ),
      )
    }

    if (conflictingKeys(group)) {
      issues.push(
        issue(
          [...at, 'remnawave'],
          `У группы «${group.name}» заданы select-random-proxy и shuffle-proxies-order одновременно — способ выборки должен быть один`,
          'warning',
        ),
      )
    }

    group.proxies.forEach((name, i) => {
      if (resolveTarget(md, name) === 'unknown') {
        issues.push(
          issue(
            [...at, 'proxies', i],
            `«${name}» не найдено среди групп и провайдеров — если это не имя хоста от панели, ссылка не разрешится`,
            'warning',
          ),
        )
      }
    })
  })

  providers.forEach((provider) => {
    if (provider.includeProxies === false) {
      issues.push(
        issue(
          ['proxy-providers', provider.name, 'remnawave', 'include-proxies'],
          `include-proxies: false допустим только в proxy-groups; у провайдера «${provider.name}» он ничего не значит`,
          'warning',
        ),
      )
    }
  })

  const cycle = findCycle(groups)
  if (cycle !== null) {
    issues.push(issue(['proxy-groups'], `Группы образуют кольцо: ${cycle.join(' → ')}`, 'error'))
  }

  /**
   * Проверки ОДНОГО списка правил. Списков в документе два вида: основной
   * `rules` и любой подсписок внутри `sub-rules`. Раньше цикл стоял прямо
   * здесь и знал только про основной — содержимое подсписков не проверялось
   * вовсе, и одна и та же опечатка давала предупреждение в `rules` и тишину
   * тремя строками ниже, в подсписке.
   *
   * Наружу отдаётся то, о чём судить может только вызывающий: где встретился
   * MATCH и был ли среди правил алиас. У основного списка из этого выводится
   * «в конце нет MATCH»; у подсписка такого вывода НЕТ и быть не может —
   * подсписок без MATCH нормален: «ничего не совпало» выводит обратно в
   * основной список, а не в прямое соединение.
   */
  const checkRuleList = (entries: RuleEntry[], base: PathParts) => {
    let matchAt = -1
    // Строка-алиас (`*r1`) — валидный YAML: содержимое лежит у якоря (`&r1`) в другом
    // месте документа, а parseRule() тут неизбежно возвращает null (текст среза — сам
    // алиас, не разрешённое значение). Раз такое правило не разбирается редактором
    // ПРИНЦИПИАЛЬНО, а не по ошибке автора, флаг гасит и текущую ошибку разбора, и
    // последующую проверку «нет MATCH»: алиас может резолвиться хоть в MATCH.
    let hasAliasRule = false
    entries.forEach((entry) => {
      const at: PathParts = [...base, entry.index]
      if (entry.rule === null) {
        if (entry.raw.trim().startsWith('*')) {
          hasAliasRule = true
          issues.push(
            issue(
              at,
              `Правило задано алиасом «${entry.raw.trim()}» — содержимое лежит у якоря, редактор не может проверить цель`,
              'warning',
            ),
          )
          return
        }
        issues.push(issue(at, `«${entry.raw}» не похоже на правило: нужны тип, значение и цель`, 'error'))
        return
      }
      const { type, target, payload, modifiers } = entry.rule
      if (!(RULE_TYPES as readonly string[]).includes(type)) {
        issues.push(issue(at, `Неизвестный тип правила «${type}»`, 'warning'))
      }
      // Тип уже проверен по словарю выше — та же логика для модификаторов:
      // без неё опечатка вроде no-resolv вместо no-resolve проходит молча
      modifiers.forEach((modifier) => {
        if (!(RULE_MODIFIERS as readonly string[]).includes(modifier)) {
          issues.push(issue(at, `Неизвестный модификатор правила «${modifier}»`, 'warning'))
        }
      })
      if (type === 'MATCH' && matchAt === -1) matchAt = entry.index
      else if (matchAt !== -1) {
        issues.push(issue(at, `Правило никогда не сработает: выше стоит MATCH`, 'warning'))
      }
      if (type === 'RULE-SET' && payload !== undefined && !ruleProviders.has(payload)) {
        issues.push(issue(at, `Набор правил «${payload}» не объявлен в rule-providers`, 'warning'))
      }
      // У SUB-RULE третье поле — имя подсписка, а не группы: гонять его через
      // resolveTarget значит ругаться на каждый корректный шаблон с подправилами
      if (type === 'SUB-RULE') {
        if (!subRules.has(target)) {
          issues.push(issue(at, `Ссылка на подсписок правил «${target}», которого нет в sub-rules`, 'warning'))
        }
        return
      }
      if (resolveTarget(md, target) === 'unknown') {
        issues.push(
          issue(
            at,
            `Цель «${target}» не найдена среди групп и провайдеров — если это не имя хоста от панели, правило не разрешится`,
            'warning',
          ),
        )
      }
    })
    return { matchAt, hasAliasRule }
  }

  const rules = rulesOf(md)
  const { matchAt, hasAliasRule } = checkRuleList(rules, ['rules'])

  // Подсписки проверяются теми же правилами: это правила Mihomo, а не другой
  // язык. Путь `sub-rules.<имя>.<индекс>` резолвер графа уже понимает — он
  // ведёт на карточку подсписка, у отдельных его правил узлов нет.
  firstPerName(subRuleEntries(md)).forEach(({ name, node }) => {
    const at: PathParts = ['sub-rules', name]
    if (!isSeq(node)) {
      // Не список — не «пустой список»: ядру здесь нечего исполнять, а
      // трассировка на таком подсписке встаёт. Сказать об этом в диагностиках
      // дешевле, чем ждать, пока пользователь дойдёт до трассировки
      issues.push(issue(at, `Подсписок «${name}» — не список правил`, 'warning'))
      return
    }
    checkRuleList(ruleEntriesOf(md, node), at)
  })

  if (rules.length > 0 && matchAt === -1 && !hasAliasRule) {
    issues.push(
      issue(['rules'], 'В конце списка нет MATCH — трафик, не подошедший ни под одно правило, пойдёт напрямую', 'warning'),
    )
  }

  return issues
}

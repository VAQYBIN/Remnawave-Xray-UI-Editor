// Диагностики документа. Главное правило: имена подставленных панелью хостов
// редактору неизвестны, поэтому «неизвестное имя цели» — предупреждение, а не
// ошибка. Строгая проверка дала бы ложную тревогу на каждом корректном шаблоне.

import type { ValidationIssue, PathParts } from '../xray/config'
import { conflictingKeys, groupGetsHosts } from './inject'
import { groupsOf, providersOf, ruleProvidersOf, subRuleNames, type MihomoGroup } from './groups'
import type { MihomoDoc } from './parse'
import { resolveTarget } from './resolve'
import { RULE_MODIFIERS, RULE_TYPES, rulesOf } from './rules'

function issue(parts: PathParts, message: string, level: 'error' | 'warning'): ValidationIssue {
  return { parts, path: parts.join('.'), message, level }
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
  const providers = providersOf(md)
  const ruleProviders = new Set(ruleProvidersOf(md).map((p) => p.name))
  const subRules = new Set(subRuleNames(md))

  const seen = new Set<string>()
  groups.forEach((group) => {
    const at: PathParts = ['proxy-groups', group.index]
    if (seen.has(group.name)) {
      issues.push(issue([...at, 'name'], `Имя группы «${group.name}» повторяется`, 'error'))
    }
    seen.add(group.name)

    if (group.hasMarker && group.remnawave.includeProxies === false) {
      issues.push(
        issue(
          [...at, 'remnawave', 'include-proxies'],
          `Группа «${group.name}» останется пустой: маркер подстановки стоит, но include-proxies: false его отменяет`,
          'warning',
        ),
      )
    } else if (!groupGetsHosts(group) && group.proxies.length === 0) {
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

  const rules = rulesOf(md)
  let matchAt = -1
  // Строка-алиас (`*r1`) — валидный YAML: содержимое лежит у якоря (`&r1`) в другом
  // месте документа, а parseRule() тут неизбежно возвращает null (текст среза — сам
  // алиас, не разрешённое значение). Раз такое правило не разбирается редактором
  // ПРИНЦИПИАЛЬНО, а не по ошибке автора, флаг гасит и текущую ошибку разбора, и
  // последующую проверку «нет MATCH»: алиас может резолвиться хоть в MATCH.
  let hasAliasRule = false
  rules.forEach((entry) => {
    const at: PathParts = ['rules', entry.index]
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

  if (rules.length > 0 && matchAt === -1 && !hasAliasRule) {
    issues.push(
      issue(['rules'], 'В конце списка нет MATCH — трафик, не подошедший ни под одно правило, пойдёт напрямую', 'warning'),
    )
  }

  return issues
}

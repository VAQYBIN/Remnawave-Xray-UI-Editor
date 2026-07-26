// Рецепт «Балансировка»: объединяет существующие outbound'ы в один балансер,
// при необходимости заводит обсерваторию и переводит на балансер правила,
// которые сейчас ведут в эти выходы напрямую.

import type { XrayConfig } from '../config'
import { ensureObservatorySection } from '../observatory'
import { ensureBalancer, repointRules } from './apply'
import type { RecipeChange, RecipeNote, RecipePlan } from './types'

export const BALANCE_STRATEGY_OPTIONS = [
  { value: 'roundRobin', label: 'roundRobin — по кругу' },
  { value: 'random', label: 'random — случайный' },
  { value: 'leastPing', label: 'leastPing — самый быстрый' },
  { value: 'leastLoad', label: 'leastLoad — наименее загруженный' },
]

export interface BalanceParams {
  tag: string
  /** Теги outbound'ов, которые объединяем */
  members: string[]
  strategy: 'random' | 'roundRobin' | 'leastPing' | 'leastLoad'
  /** Пусто — без запасного выхода */
  fallbackTag: string
  /** Перевести правила этих выходов на балансер */
  repoint: boolean
}

export const BALANCE_DEFAULTS: BalanceParams = {
  tag: 'balancer',
  members: [],
  strategy: 'roundRobin',
  fallbackTag: '',
  repoint: true,
}

export function validateBalance(params: BalanceParams): string | null {
  if (params.tag.trim() === '') return 'Укажите тег балансера'
  if (params.members.length < 2) return 'Выберите хотя бы два выхода — балансировать один смысла нет'
  if (params.fallbackTag !== '' && params.members.includes(params.fallbackTag)) {
    return 'Запасной выход не должен входить в список балансируемых'
  }
  return null
}

export function planBalance(config: XrayConfig, params: BalanceParams): RecipePlan {
  const changes: RecipeChange[] = []
  const notes: RecipeNote[] = []
  const tag = params.tag.trim()

  const balancer = {
    tag,
    selector: [...params.members],
    ...(params.fallbackTag === '' ? {} : { fallbackTag: params.fallbackTag }),
    strategy: { type: params.strategy },
  }
  const withBalancer = ensureBalancer(config, balancer)
  changes.push({
    status: withBalancer.status,
    text:
      withBalancer.status === 'add'
        ? `балансер ${tag} (${params.strategy}) из ${params.members.join(', ')}`
        : `балансер ${tag} — уже есть, используем`,
  })

  let next = withBalancer.config
  if (params.strategy === 'leastPing' || params.strategy === 'leastLoad') {
    const kind = params.strategy === 'leastLoad' ? 'burst' : 'observatory'
    const section = kind === 'burst' ? 'burstObservatory' : 'observatory'
    const afterObs = ensureObservatorySection(next, kind, params.members)
    changes.push({
      status: afterObs === next ? 'exists' : 'add',
      text:
        afterObs === next
          ? `${section} — уже наблюдает эти выходы`
          : `${section} наблюдает ${params.members.join(', ')}`,
    })
    next = afterObs
  }

  if (params.repoint) {
    const repointed = repointRules(next, params.members, tag)
    changes.push({
      status: repointed.count > 0 ? 'add' : 'exists',
      text:
        repointed.count > 0
          ? `правил переведено на балансер: ${repointed.count}`
          : 'правил, ведущих в эти выходы напрямую, нет',
    })
    next = repointed.config
  }

  if (params.fallbackTag === '') {
    notes.push({
      text: 'Без запасного выхода недоступность всех кандидатов означает обрыв соединений.',
    })
  }

  return { config: next, changes, notes }
}

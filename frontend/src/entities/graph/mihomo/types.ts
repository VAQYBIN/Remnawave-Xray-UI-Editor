import type { IssueCount } from '../types'

export interface MihomoRuleNodeData extends Record<string, unknown> {
  kind: 'mihomo-rule'
  index: number
  type: string
  payload?: string
  /**
   * Цель правила — заполняется ВСЕГДА, даже когда она не разрешается ни в
   * группу, ни в провайдера, ни во встроенное имя (ребро тогда не рисуется).
   * Цель бывает именем хоста от панели — это норма по спеке, а не ошибка
   * документа: без поля пользователь видел бы узел правила без единого
   * упоминания того, куда оно ведёт. У SUB-RULE это имя подсписка правил,
   * а не группы.
   */
  target?: string
  modifiers: string[]
  /** Вердикт трассировки; 'winner' — правило, которое победило */
  traceState?: 'yes' | 'no' | 'unknown' | 'winner'
  issueCount?: IssueCount
}
export interface MihomoGroupNodeData extends Record<string, unknown> {
  kind: 'mihomo-group'
  index: number
  name: string
  type?: string
  /** Сколько имён перечислено вручную */
  manual: number
  hidden: boolean
  /** Положит ли панель в группу хосты */
  getsHosts: boolean
  issueCount?: IssueCount
}
export interface MihomoProviderNodeData extends Record<string, unknown> {
  kind: 'mihomo-provider'
  name: string
  type?: string
  dialerProxy?: string
  issueCount?: IssueCount
}
export interface MihomoProxyNodeData extends Record<string, unknown> {
  kind: 'mihomo-proxy'
  index: number
  name: string
  type?: string
  server?: string
  issueCount?: IssueCount
}
export interface MihomoHostsNodeData extends Record<string, unknown> {
  kind: 'mihomo-hosts'
  /** 'root' — корневой proxies, иначе имя группы */
  owner: string
  filter?: string
  excludeFilter?: string
  /** Как панель выберет хосты: все, один случайный, все вперемешку */
  pick: 'all' | 'random' | 'shuffled'
}
export interface MihomoBuiltinNodeData extends Record<string, unknown> {
  kind: 'mihomo-builtin'
  name: string
}
export interface MihomoSubRuleNodeData extends Record<string, unknown> {
  kind: 'mihomo-subrule'
  name: string
  /** Сколько правил в подсписке — раскрывать их узлами незачем, их читает инспектор */
  count: number
  /**
   * Цели правил подсписка в порядке появления, без повторов. Здесь лежат ВСЕ
   * цели, включая неразрешимые (имя хоста от панели — норма, а не ошибка), тем
   * же правилом, что и `target` у узла правила; ребро рисуется только на
   * разрешимую.
   */
  targets: string[]
  issueCount?: IssueCount
}

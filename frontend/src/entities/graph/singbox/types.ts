// Данные узлов графа sing-box. Все интерфейсы расширяют Record<string, unknown> —
// этого требует @xyflow/react от данных узла.

import type { IssueCount } from '../types'

export interface SingboxInboundNodeData extends Record<string, unknown> {
  kind: 'singbox-inbound'
  index: number
  tag: string
  type: string
  /** Порт прослушивания; у tun его нет вовсе */
  port?: number | string
  issueCount?: IssueCount
}

export interface SingboxRuleNodeData extends Record<string, unknown> {
  kind: 'singbox-rule'
  index: number
  /** Действие правила; у правила без него — 'route', так его понимает и ядро */
  action: string
  /** Условия правила короткими строками: их читает человек на карточке */
  summary: string[]
  /** Имена наборов правил: набор — свойство правила, а не узел графа */
  ruleSets: string[]
  /**
   * Цель правила — заполняется ВСЕГДА, даже когда она не разрешается ни в один
   * узел и ребро не рисуется. Цель бывает именем сервера, который подставит
   * панель: без поля пользователь видел бы узел правила без единого упоминания
   * того, куда оно ведёт.
   */
  target?: string
  traceState?: 'yes' | 'no' | 'unknown' | 'winner'
  issueCount?: IssueCount
}

export interface SingboxGroupNodeData extends Record<string, unknown> {
  kind: 'singbox-group'
  index: number
  tag: string
  type: string
  /** Сколько имён перечислено в документе вручную */
  listed: number
  /** Заполнит ли список панель: от этого зависит и ребро, и доступность формы */
  panelFills: boolean
  issueCount?: IssueCount
}

export interface SingboxOutNodeData extends Record<string, unknown> {
  kind: 'singbox-out'
  index: number
  tag: string
  type: string
  /** Сюда уйдёт трафик, не совпавший ни с одним правилом */
  isDefault: boolean
  /** Добавит ли панель этот выход в списки групп: своё для четвёрки протоколов */
  panelPicks: boolean
  issueCount?: IssueCount
}

export interface SingboxHostsNodeData extends Record<string, unknown> {
  kind: 'singbox-hosts'
  /** Сколько групп получит серверы от панели */
  groups: number
}

export interface SingboxBuiltinNodeData extends Record<string, unknown> {
  kind: 'singbox-builtin'
  action: string
}

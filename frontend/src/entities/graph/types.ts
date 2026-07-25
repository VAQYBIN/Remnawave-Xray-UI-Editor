import type { Node, Edge } from '@xyflow/react'

export interface SquadRef { uuid: string; name: string }

/** Сколько проблем висит на узле; ошибки и предупреждения не смешиваем */
export interface IssueCount {
  errors: number
  warnings: number
}

export interface InboundNodeData extends Record<string, unknown> {
  kind: 'inbound'; index: number; tag: string; protocol: string
  port?: number | string; network?: string; security?: string; squadsCount?: number
  issueCount?: IssueCount
}
export interface OutboundNodeData extends Record<string, unknown> {
  kind: 'outbound'; index: number; tag: string; protocol: string; isDefault: boolean
  issueCount?: IssueCount
}
export interface RuleNodeData extends Record<string, unknown> {
  kind: 'rule'; index: number; summary: string[]; allInbounds: boolean
  /** Вердикт трассировки; 'winner' — правило, которое победило */
  traceState?: 'yes' | 'no' | 'unknown' | 'winner'
  issueCount?: IssueCount
}
export interface DnsNodeData extends Record<string, unknown> {
  kind: 'dns'; serversCount: number
  issueCount?: IssueCount
}
export interface SquadNodeData extends Record<string, unknown> { kind: 'squad'; name: string }

export type FlowNode = Node
export type FlowEdge = Edge

export interface GraphContext {
  squads?: SquadRef[]                       // сквады, привязанные к inbound'ам профиля
  inboundSquads?: Record<string, string[]>  // tag inbound'а -> uuid'ы сквадов
}

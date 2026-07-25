import type { Node, Edge } from '@xyflow/react'

export interface SquadRef { uuid: string; name: string }

export interface InboundNodeData extends Record<string, unknown> {
  kind: 'inbound'; index: number; tag: string; protocol: string
  port?: number | string; network?: string; security?: string; squadsCount?: number
}
export interface OutboundNodeData extends Record<string, unknown> {
  kind: 'outbound'; index: number; tag: string; protocol: string; isDefault: boolean
}
export interface RuleNodeData extends Record<string, unknown> {
  kind: 'rule'; index: number; summary: string[]; allInbounds: boolean
  /** Вердикт трассировки; 'winner' — правило, которое победило */
  traceState?: 'yes' | 'no' | 'unknown' | 'winner'
}
export interface DnsNodeData extends Record<string, unknown> { kind: 'dns'; serversCount: number }
export interface SquadNodeData extends Record<string, unknown> { kind: 'squad'; name: string }

export type FlowNode = Node
export type FlowEdge = Edge

export interface GraphContext {
  squads?: SquadRef[]                       // сквады, привязанные к inbound'ам профиля
  inboundSquads?: Record<string, string[]>  // tag inbound'а -> uuid'ы сквадов
}

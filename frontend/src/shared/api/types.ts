export interface PanelInboundView {
  uuid: string
  tag: string
  type: string
  network: string | null
  security: string | null
  port: number | null
}

export interface PanelNodeRef {
  uuid: string
  name: string
  countryCode: string
}

export interface Profile {
  uuid: string
  viewPosition: number
  name: string
  config: unknown
  inbounds: PanelInboundView[]
  nodes: PanelNodeRef[]
  createdAt: string
  updatedAt: string
}

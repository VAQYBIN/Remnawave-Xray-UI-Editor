export interface PanelInbound {
  uuid: string
  profileUuid: string
  tag: string
  type: string
  network: string | null
  security: string | null
  port: number | null
  rawInbound: unknown
}

export interface PanelNodeRef {
  uuid: string
  name: string
  countryCode: string
}

export interface ConfigProfile {
  uuid: string
  viewPosition: number
  name: string
  config: unknown
  inbounds: PanelInbound[]
  nodes: PanelNodeRef[]
  createdAt: string
  updatedAt: string
}

export interface RemnawavePort {
  listProfiles(): Promise<ConfigProfile[]>
  getProfile(uuid: string): Promise<ConfigProfile>
  createProfile(name: string, config: unknown): Promise<ConfigProfile>
  updateProfile(input: { uuid: string; name?: string; config?: unknown }): Promise<ConfigProfile>
  deleteProfile(uuid: string): Promise<void>
  getNodes(): Promise<unknown[]>
  getSquads(): Promise<unknown[]>
}

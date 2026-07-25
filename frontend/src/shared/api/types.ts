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

export interface SquadInfo {
  uuid: string
  name: string
}

export interface ProfileInboundDetail {
  uuid: string
  tag: string
  type: string
  network: string | null
  security: string | null
  port: number | null
  activeSquads: string[]
}

export interface BackupEntry {
  file: string
  savedAt: string
  profileName: string
}

export interface BackupFileData {
  savedAt: string
  profile: Profile
}

export interface GeoSourceStatus {
  url: string
  present: boolean
  loadedAt?: string
  sizeBytes?: number
  categories?: number
}

export interface GeoStatus {
  geosite: GeoSourceStatus
  geoip: GeoSourceStatus
}

export interface GeoMatchAnswer {
  loaded: boolean
  answers: Record<string, boolean>
  missing: string[]
}

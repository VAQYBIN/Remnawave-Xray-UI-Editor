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

/** Срок действия REMNAWAVE_TOKEN; null'ы — панель выдала токен, чей срок не разобрать */
export interface PanelTokenStatus {
  expiresAt: string | null
  daysLeft: number | null
  expired: boolean
  expiringSoon: boolean
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

export type GeoKind = 'geosite' | 'geoip'

export interface GeoCategory {
  code: string
  count: number
}

export interface GeoDomainItem {
  type: 'keyword' | 'regexp' | 'domain' | 'full'
  value: string
  attributes: string[]
}

export interface GeoCategoryPage {
  code: string
  total: number
  offset: number
  /** geosite */
  domains?: GeoDomainItem[]
  /** geoip */
  cidrs?: string[]
  reverseMatch?: boolean
}

export interface GeoMatchAnswer {
  loaded: boolean
  answers: Record<string, boolean>
  missing: string[]
}

export interface XrayTestError {
  message: string
  line?: number
  hint?: string
  code?: 'geo'
}

export interface InjectedClient {
  tag: string
  /** 'panel' — клиент взят из computed-config панели, 'dummy' — подставлен редактором */
  source: 'panel' | 'dummy'
}

export interface XrayTestResult {
  available: boolean
  ok: boolean
  version?: string
  errors: XrayTestError[]
  /** Предупреждения ядра: приходят и при успешной проверке */
  warnings: string[]
  /** Inbound'ы, куда на время проверки подставлен пользователь, и откуда он взят */
  injected: InjectedClient[]
}

export type CheckLevel = 'ok' | 'warn' | 'error'

export interface RealityCheck {
  id: string
  level: CheckLevel
  title: string
  detail?: string
}

export interface RealityPeerInfo {
  protocol: string | null
  cipher?: string
  alpn?: string | null
  keyExchange?: string
  subject?: string
  issuer?: string
  altNames: string[]
  validTo?: string
  authorized?: boolean
  authorizationError?: string
}

export interface RealityProbeResult {
  target: string
  host?: string
  port?: number
  reachable: boolean
  error?: string
  info?: RealityPeerInfo
  checks: RealityCheck[]
}

/** Ответ регистрации WARP: то же, что выдаёт wgcf, только уже в терминах wireguard-outbound */
export interface WarpAccount {
  secretKey: string
  address: string[]
  reserved: number[]
  peer: { publicKey: string; endpoint: string }
}

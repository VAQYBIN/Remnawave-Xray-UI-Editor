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

/**
 * Набор правил в запросе к `/api/tools/ruleset/match`. Форма — ровно та, что
 * принимает `ruleSetSchema` роута: виды `file` и `unsupported` сюда не попадают
 * по построению — их состояние известно без сети, и спрашивать о них нечего.
 */
export interface RuleSetQuery {
  name: string
  kind: 'http' | 'inline'
  url?: string
  payload?: string[]
  behavior: 'domain' | 'ipcidr' | 'classical'
  format: 'mrs' | 'yaml' | 'text'
  intervalSec?: number
}

/**
 * Ответ по одному набору. Повторяет `RuleSetAnswer` бэкенда, как
 * `GeoMatchAnswer` повторяет ответ geo: слой `shared` не знает про `entities`,
 * поэтому форма провода описана здесь, а трассировка держит свою копию.
 */
export type RuleSetMatchAnswer =
  | { state: 'yes' | 'no'; count: number; loadedAt?: number }
  | { state: 'lines'; lines: string[]; count: number; loadedAt?: number }
  | { state: 'unavailable'; reason: string }

export interface RuleSetMatchResponse {
  answers: Record<string, RuleSetMatchAnswer>
}

/**
 * Состояние набора по кэшу редактора. Повторяет `RuleSetStatusItem` бэкенда:
 * слой `shared` не знает про `entities`, поэтому форма провода описана здесь.
 */
export interface RuleSetStatusItem {
  name: string
  state: 'ready' | 'missing' | 'error'
  /** Записей по заголовку набора — не число строк просмотрщика */
  count?: number
  bytes?: number
  loadedAt?: number
  /** Файл старше своего срока годности: следующая трассировка перекачает его */
  stale?: boolean
  reason?: string
}

export interface RuleSetStatusResponse {
  items: RuleSetStatusItem[]
}

export interface RuleSetPageResponse {
  /** Сколько записей нашлось всего (с учётом поиска) */
  total: number
  offset: number
  /** `count` из заголовка набора: у набора доменов он ВДВОЕ меньше `total` */
  count: number
  items: string[]
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

/** Ответ `POST /api/tools/mihomo-test` — зеркало MihomoTestResult бэкенда */
export interface MihomoTestResult {
  /** false — бинаря нет: инструмент недоступен, а шаблон тут ни при чём */
  available: boolean
  ok: boolean
  errors: string[]
}

/**
 * Запись каталога готовых шаблонов. `type` — строка, а не TemplateType:
 * каталог опережает контракт панели (в нём уже лежит SINGBOX_LEGACY), и
 * сужение типа уронило бы весь список на одном незнакомом значении.
 * `url` берётся из индекса и уходит обратно как есть — произвольную ссылку
 * бэкенд отвергает (защита от SSRF).
 */
export interface CatalogEntry {
  name: string
  type: string
  author: string
  url: string
}

/** Те же типы списком: тип из каталога приходит строкой, и опознать его нечем */
export const TEMPLATE_TYPES = [
  'XRAY_JSON',
  'XRAY_BASE64',
  'MIHOMO',
  'STASH',
  'CLASH',
  'SINGBOX',
] as const

export type TemplateType = (typeof TEMPLATE_TYPES)[number]

/** Шаблон, тип которого уже известен: редактору не нужно повторять его строкой */
export type TemplateOfType<T extends TemplateType> = SubscriptionTemplate & {
  templateType: T
}

/**
 * Проверка типа шаблона, сужающая САМ ШАБЛОН, а не только доступ к полю.
 * `template.templateType === 'MIHOMO'` объект не сужает: `SubscriptionTemplate` —
 * один интерфейс с union-полем, а не размеченное объединение, и знание о типе
 * дальше по коду теряется. Из-за этого страница редактора повторяла свой тип
 * строкой — и повторяла бы его неверно, если бы ветку однажды переставили.
 */
export function isTemplateOfType<T extends TemplateType>(
  template: SubscriptionTemplate,
  type: T,
): template is TemplateOfType<T> {
  return template.templateType === type
}

/**
 * Шаблон подписки. Полей createdAt/updatedAt здесь НЕТ — защита при сохранении
 * строится на хэше содержимого, который считает бэкенд.
 */
export interface SubscriptionTemplate {
  uuid: string
  viewPosition: number
  name: string
  tags?: string[]
  templateType: TemplateType
  /** JSON-типы (XRAY_JSON, SINGBOX); у YAML-типов здесь null */
  templateJson: unknown
  /** YAML-типы (MIHOMO, CLASH, STASH) в base64; у JSON-типов null */
  encodedTemplateYaml: string | null
}

export interface TemplateBackupFileData {
  savedAt: string
  template: SubscriptionTemplate
}

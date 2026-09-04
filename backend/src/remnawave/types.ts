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

export interface PanelInboundDetail extends PanelInbound {
  activeSquads: string[]
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
  /** Панель 3.4.0+; редактор их не использует, но и не теряет: PATCH шлёт только name/config */
  tags?: string[]
  config: unknown
  inbounds: PanelInbound[]
  nodes: PanelNodeRef[]
  createdAt: string
  updatedAt: string
}

/** Типы шаблонов подписки панели 3.4.x (см. @remnawave/backend-contract) */
export type TemplateType =
  | 'XRAY_JSON'
  | 'XRAY_BASE64'
  | 'MIHOMO'
  | 'STASH'
  | 'CLASH'
  | 'SINGBOX'

/**
 * Шаблон подписки. Полей createdAt/updatedAt здесь НЕТ — оптимистическая
 * блокировка профилей через expectedUpdatedAt тут неприменима, защита строится
 * на сравнении содержимого (backend/src/templates/hash.ts).
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

export interface RemnawavePort {
  listProfiles(): Promise<ConfigProfile[]>
  getProfile(uuid: string): Promise<ConfigProfile>
  createProfile(name: string, config: unknown): Promise<ConfigProfile>
  updateProfile(input: { uuid: string; name?: string; config?: unknown }): Promise<ConfigProfile>
  deleteProfile(uuid: string): Promise<void>
  getNodes(): Promise<unknown[]>
  getSquads(): Promise<unknown[]>
  getProfileInbounds(uuid: string): Promise<PanelInboundDetail[]>
  getComputedConfig(uuid: string): Promise<unknown>
  listTemplates(): Promise<SubscriptionTemplate[]>
  getTemplate(uuid: string): Promise<SubscriptionTemplate>
  createTemplate(name: string, templateType: TemplateType): Promise<SubscriptionTemplate>
  updateTemplate(input: {
    uuid: string
    name?: string
    templateJson?: unknown
  }): Promise<SubscriptionTemplate>
  deleteTemplate(uuid: string): Promise<void>
}

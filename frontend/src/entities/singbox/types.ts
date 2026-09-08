// Типы документа sing-box. Все интерфейсы открыты индексной сигнатурой: схема
// разбора сквозная, и ключ, которого мы не знаем, обязан доезжать до текста
// нетронутым, а не исчезать при первом сохранении.

/** Ключ панели внутри элемента outbounds. camelCase — не описка: у Mihomo он kebab-case */
export interface SingboxPanelKey {
  includeProxies?: boolean
}

export interface SingboxOutbound {
  type: string
  tag?: string
  /**
   * У групп — список тегов. `null` пишет дефолтный шаблон панели, и это НЕ то же
   * самое, что пустой список: панель перезапишет и то и другое, а вот форма
   * должна различать «поле не заполняли» и «заполнили пустым».
   */
  outbounds?: string[] | null
  remnawave?: SingboxPanelKey
  [key: string]: unknown
}

export interface SingboxInbound {
  type: string
  tag?: string
  [key: string]: unknown
}

/** Правило маршрута: набор условий плюс служебные поля. Условия свободны по составу */
export interface SingboxRule {
  [key: string]: unknown
}

export interface SingboxRuleSet {
  tag?: string
  [key: string]: unknown
}

export interface SingboxRoute {
  rules?: SingboxRule[]
  rule_set?: SingboxRuleSet[]
  final?: string
  [key: string]: unknown
}

export interface SingboxDns {
  servers?: Record<string, unknown>[]
  rules?: SingboxRule[]
  final?: string
  [key: string]: unknown
}

export interface SingboxDoc {
  log?: Record<string, unknown>
  dns?: SingboxDns
  inbounds?: SingboxInbound[]
  outbounds?: SingboxOutbound[]
  endpoints?: Record<string, unknown>[]
  route?: SingboxRoute
  experimental?: Record<string, unknown>
  [key: string]: unknown
}

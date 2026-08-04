// Матрица совместимости security × network — жёсткое ограничение ядра Xray.
// Единый источник и для форм (фильтрация select'ов, предупреждения), и для
// analyzeIntegrity (план 4). Сверено со справочником remnawave-xray:
//   reality — только raw(tcp)/xhttp/grpc; flow vision — только raw;
//   network hysteria — только tls с настоящим сертификатом.

/** 'raw' — новое имя 'tcp' (Xray v24.9.30); в хранимых конфигах встречаются оба */
export function normalizeNetwork(network: string | undefined): string {
  const n = network ?? 'tcp'
  return n === 'raw' ? 'tcp' : n
}

/** Поля streamSettings, из которых читается транспорт */
export interface StreamNetworkSource {
  network?: string
  method?: string
}

/**
 * Транспорт узла. Xray v26.7.28 переименовал `network` в `method` (PR #6426) и
 * оставил старое имя алиасом, но в StreamConfig.Build действует
 * `if c.Method != nil { c.Network = c.Method }` — при обоих ключах слушается
 * `method`. Читать транспорт где-либо ещё, кроме этой функции, нельзя.
 */
export function streamNetwork(stream: StreamNetworkSource | undefined): string | undefined {
  return stream?.method ?? stream?.network
}

export const ALL_NETWORKS = ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'hysteria']

const REALITY_NETWORKS = ['tcp', 'xhttp', 'grpc']

/** Транспорты, допустимые при данном security (нормализованные имена) */
export function allowedNetworks(security: string | undefined): string[] {
  if (security === 'reality') return [...REALITY_NETWORKS]
  return [...ALL_NETWORKS]
}

/** Security, допустимые при данном транспорте */
export function allowedSecurities(network: string | undefined): string[] {
  const n = normalizeNetwork(network)
  if (n === 'hysteria') return ['tls']
  if (REALITY_NETWORKS.includes(n)) return ['none', 'tls', 'reality']
  return ['none', 'tls']
}

/** null — совместимо; иначе русское сообщение для предупреждения формы / IssueList */
export function securityNetworkIssue(
  security: string | undefined,
  network: string | undefined,
): string | null {
  const n = normalizeNetwork(network)
  const sec = security ?? 'none'
  if (sec === 'reality' && !REALITY_NETWORKS.includes(n)) {
    return `Reality несовместим с транспортом «${n}» — допустимы только raw (tcp), xhttp и grpc`
  }
  if (n === 'hysteria' && sec !== 'tls') {
    return 'Транспорт hysteria требует security «tls» с настоящим сертификатом'
  }
  return null
}

/** flow xtls-rprx-vision (и -udp443) работает только поверх raw (tcp) */
export function flowNetworkIssue(
  flow: string | undefined,
  network: string | undefined,
): string | null {
  if (!flow || !flow.startsWith('xtls-rprx-vision')) return null
  if (normalizeNetwork(network) !== 'tcp') {
    return `Flow «${flow}» работает только поверх raw (tcp) — уберите flow или смените транспорт`
  }
  return null
}

/** Транспорт hysteria без TLS-сертификатов не стартует (Reality тут не используется) */
export function hysteriaCertificateIssue(
  network: string | undefined,
  security: string | undefined,
  tlsSettings: { certificates?: unknown[] } | undefined,
): string | null {
  if (normalizeNetwork(network) !== 'hysteria') return null
  if ((security ?? 'none') !== 'tls') return null // это уже поймал securityNetworkIssue
  if ((tlsSettings?.certificates?.length ?? 0) === 0) {
    return 'Для hysteria нужен настоящий TLS-сертификат — добавьте certificates в tlsSettings'
  }
  return null
}

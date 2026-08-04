// Ядро Xray с v26.7.28 разрешает VLESS и Trojan без шифрования только на
// приватный адрес и сверяется с geosite-категорией `private` (PR #6303).
// Категорию целиком не повторить — берём практическое подмножество и считаем
// всё остальное публичным, ровно как поступает ядро с неизвестным доменом.

const PRIVATE_SUFFIXES = ['.local', '.lan', '.internal', '.home', '.home.arpa']

/** true/false для IPv4-литерала, undefined — это не IPv4 */
function isPrivateV4(host: string): boolean | undefined {
  const parts = host.split('.')
  if (parts.length !== 4) return undefined
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return undefined
  const [a, b] = nums as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function isPrivateAddress(address: string): boolean {
  let host = address.trim().toLowerCase()
  if (host === '') return false
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host === 'localhost') return true

  const v4 = isPrivateV4(host)
  if (v4 !== undefined) return v4

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    // fc00::/7 (ULA) и fe80::/10 (link-local)
    return /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  }

  return PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

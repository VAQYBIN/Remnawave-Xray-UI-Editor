// Генераторы значений для форм (Web Crypto)

export function randomUuid(): string {
  return crypto.randomUUID()
}

export function randomShortId(bytes = 4): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomBase64(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...buf))
}

// Shadowsocks-2022 требует ключ фиксированной длины в base64; классические методы — любой пароль
export function ssPassword(method: string): string {
  if (method === '2022-blake3-aes-256-gcm') return randomBase64(32)
  return randomBase64(16)
}

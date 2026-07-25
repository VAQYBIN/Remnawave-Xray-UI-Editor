// Профили Remnawave хранятся с пустым clients: пользователей инжектит панель при
// раздаче конфига на ноды. Прогон такого документа ядром дал бы ложные ошибки на
// том, что в проде валидно, поэтому перед проверкой подставляем одного фиктивного.

/** Фиксированный UUID: вердикт проверки не должен зависеть от случайного значения */
export const DUMMY_UUID = '11111111-1111-4111-8111-111111111111'
const DUMMY_EMAIL = 'xray-ui-editor@test'
const DUMMY_PASSWORD = 'xray-ui-editor-dummy-password'

// Методы 2022 требуют ключ ровно такой длины в base64, иначе ядро отказывается
const SS2022_KEY_BYTES: Record<string, number> = {
  '2022-blake3-aes-128-gcm': 16,
  '2022-blake3-aes-256-gcm': 32,
  '2022-blake3-chacha20-poly1305': 32,
}

export interface DummyInjection {
  config: unknown
  /** Теги inbound'ов, куда подставлен пользователь — отчёт обязан это показать */
  injected: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function dummyClientFor(
  protocol: string,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  if (protocol === 'trojan') return { password: DUMMY_PASSWORD, email: DUMMY_EMAIL }
  if (protocol === 'shadowsocks') {
    const method = typeof settings.method === 'string' ? settings.method : undefined
    const keyBytes = method === undefined ? undefined : SS2022_KEY_BYTES[method]
    if (keyBytes !== undefined) {
      return { password: Buffer.alloc(keyBytes, 7).toString('base64'), email: DUMMY_EMAIL }
    }
    // Метод не задан на уровне settings — ядро ждёт его на клиенте
    if (method === undefined) {
      return { password: DUMMY_PASSWORD, method: 'chacha20-ietf-poly1305', email: DUMMY_EMAIL }
    }
    return { password: DUMMY_PASSWORD, email: DUMMY_EMAIL }
  }
  return { id: DUMMY_UUID, email: DUMMY_EMAIL }
}

export function withDummyClients(config: unknown): DummyInjection {
  const injected: string[] = []
  if (!isRecord(config)) return { config, injected }

  const next = structuredClone(config) as Record<string, unknown>
  if (!Array.isArray(next.inbounds)) return { config: next, injected }

  for (const raw of next.inbounds) {
    if (!isRecord(raw)) continue
    const protocol = typeof raw.protocol === 'string' ? raw.protocol : ''
    if (protocol !== 'vless' && protocol !== 'trojan' && protocol !== 'shadowsocks') continue

    if (!isRecord(raw.settings)) raw.settings = {}
    const settings = raw.settings as Record<string, unknown>
    if (Array.isArray(settings.clients) && settings.clients.length > 0) continue
    // Одиночный shadowsocks (пароль в settings) — валидный конфиг без clients
    if (
      protocol === 'shadowsocks' &&
      typeof settings.password === 'string' &&
      settings.password !== ''
    ) {
      continue
    }

    settings.clients = [dummyClientFor(protocol, settings)]
    injected.push(typeof raw.tag === 'string' ? raw.tag : protocol)
  }

  return { config: next, injected }
}

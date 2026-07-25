// Регистрация бесплатного аккаунта Cloudflare WARP — то же, что делает утилита wgcf.
// API неофициальный: любая неожиданность превращается в понятную ошибку, а не в падение,
// потому что у пользователя всегда остаётся ручной ввод ключей.

import { z } from 'zod'
import { fetchExternal, type FetchGuardOptions } from '../net/guard.js'
import { generateX25519Raw } from './reality.js'

const API = 'https://api.cloudflareclient.com/v0a2158/reg'
const CLIENT_HEADERS = {
  'CF-Client-Version': 'a-6.10-2158',
  'User-Agent': 'okhttp/3.12.1',
  'Content-Type': 'application/json',
  Accept: 'application/json',
}
const TIMEOUT_MS = 10_000

export interface WarpAccount {
  /** Приватный ключ в base64 с padding — формат, который ждёт wireguard-outbound Xray */
  secretKey: string
  address: string[]
  reserved: number[]
  peer: { publicKey: string; endpoint: string }
}

export type WarpRegister = () => Promise<WarpAccount>

const regSchema = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  config: z.object({
    client_id: z.string().min(1),
    peers: z
      .array(
        z.object({
          public_key: z.string().min(1),
          endpoint: z.object({ host: z.string().min(1) }),
        }),
      )
      .min(1),
    interface: z.object({ addresses: z.object({ v4: z.string().min(1), v6: z.string().min(1) }) }),
  }),
})

export async function registerWarpAccount(opts: FetchGuardOptions = {}): Promise<WarpAccount> {
  const { privateKey, publicKey } = generateX25519Raw()

  const regRes = await fetchExternal(API, {
    ...opts,
    timeoutMs: TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: CLIENT_HEADERS,
      body: JSON.stringify({
        key: publicKey.toString('base64'),
        install_id: '',
        fcm_token: '',
        tos: new Date().toISOString(),
        model: 'PC',
        serial_number: '',
        locale: 'en_US',
      }),
    },
  })
  if (!regRes.ok) {
    throw new Error(`Cloudflare ответил ${regRes.status} на регистрацию устройства`)
  }

  let parsed: z.infer<typeof regSchema>
  try {
    parsed = regSchema.parse(await regRes.json())
  } catch {
    throw new Error('Неожиданный ответ Cloudflare: в нём нет параметров WireGuard')
  }

  // Без этого шага аккаунт создан, но WARP на нём выключен — туннель поднимется в пустоту
  const patchRes = await fetchExternal(`${API}/${parsed.id}`, {
    ...opts,
    timeoutMs: TIMEOUT_MS,
    init: {
      method: 'PATCH',
      headers: { ...CLIENT_HEADERS, Authorization: `Bearer ${parsed.token}` },
      body: JSON.stringify({ warp_enabled: true }),
    },
  })
  if (!patchRes.ok) {
    throw new Error(`Cloudflare не включил WARP на аккаунте (${patchRes.status})`)
  }

  const { addresses } = parsed.config.interface
  const peer = parsed.config.peers[0]!
  return {
    secretKey: privateKey.toString('base64'),
    address: [`${addresses.v4}/32`, `${addresses.v6}/128`],
    reserved: Array.from(Buffer.from(parsed.config.client_id, 'base64')),
    peer: { publicKey: peer.public_key, endpoint: peer.endpoint.host },
  }
}

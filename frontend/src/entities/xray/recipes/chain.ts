// Рецепт «Цепочка через другой сервер»: outbound на второй сервер + правило,
// направляющее в него выбранный трафик. dialerProxy даёт второй хоп в одном соединении.

import type { XrayConfig } from '../config'
import { ensureOutbound, ensureRule, ruleOrdinal } from './apply'
import type { RecipeChange, RecipePlan } from './types'

export const CHAIN_PROTOCOLS = [
  { value: 'vless', label: 'vless' },
  { value: 'trojan', label: 'trojan' },
  { value: 'socks', label: 'socks' },
]

export interface ChainParams {
  tag: string
  protocol: 'vless' | 'trojan' | 'socks'
  address: string
  port: number
  /** vless */
  uuid: string
  /** trojan и socks */
  password: string
  /** socks */
  username: string
  tls: boolean
  /** Пусто — без промежуточного хопа */
  dialerProxy: string
  /** Пусто — правило без условий, то есть весь трафик */
  domains: string[]
}

export const CHAIN_DEFAULTS: ChainParams = {
  tag: 'chain',
  protocol: 'vless',
  address: '',
  port: 443,
  uuid: '',
  password: '',
  username: '',
  tls: true,
  dialerProxy: '',
  domains: [],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateChain(params: ChainParams): string | null {
  if (params.tag.trim() === '') return 'Укажите тег outbound’а'
  if (params.address.trim() === '') return 'Укажите адрес сервера'
  if (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535) {
    return 'Порт: целое число от 1 до 65535'
  }
  if (params.protocol === 'vless' && !UUID_RE.test(params.uuid.trim())) {
    return 'UUID пользователя: 8-4-4-4-12 шестнадцатеричных символов'
  }
  if (params.protocol === 'trojan' && params.password.trim() === '') {
    return 'Укажите пароль trojan'
  }
  if (params.protocol === 'socks' && params.username.trim() !== '' && params.password.trim() === '') {
    return 'Для socks с именем пользователя нужен пароль'
  }
  if (params.dialerProxy.trim() !== '' && params.dialerProxy.trim() === params.tag.trim()) {
    return 'dialerProxy не может указывать на себя же'
  }
  return null
}

function chainSettings(params: ChainParams): Record<string, unknown> {
  if (params.protocol === 'vless') {
    return {
      vnext: [
        {
          address: params.address,
          port: params.port,
          users: [{ id: params.uuid.trim(), encryption: 'none' }],
        },
      ],
    }
  }
  if (params.protocol === 'trojan') {
    return { servers: [{ address: params.address, port: params.port, password: params.password }] }
  }
  const server: Record<string, unknown> = { address: params.address, port: params.port }
  if (params.username.trim() !== '') {
    server.users = [{ user: params.username, pass: params.password }]
  }
  return { servers: [server] }
}

function chainStream(params: ChainParams): Record<string, unknown> {
  const stream: Record<string, unknown> = {
    network: 'tcp',
    security: params.tls ? 'tls' : 'none',
  }
  if (params.tls) stream.tlsSettings = { serverName: params.address }
  if (params.dialerProxy.trim() !== '') stream.sockopt = { dialerProxy: params.dialerProxy.trim() }
  return stream
}

export function planChain(config: XrayConfig, params: ChainParams): RecipePlan {
  const changes: RecipeChange[] = []

  const outbound = ensureOutbound(config, {
    tag: params.tag,
    protocol: params.protocol,
    settings: chainSettings(params),
    streamSettings: chainStream(params),
  })
  changes.push({
    status: outbound.status,
    text:
      outbound.status === 'add'
        ? `outbound ${params.tag} (${params.protocol} → ${params.address}:${params.port})`
        : `outbound ${params.tag} — уже есть, используем`,
  })

  const rule =
    params.domains.length > 0
      ? { domain: params.domains, outboundTag: params.tag }
      : { outboundTag: params.tag }
  const merged = ensureRule(outbound.config, rule, 'route')
  const what = params.domains.length > 0 ? params.domains.join(', ') : 'весь трафик'
  changes.push({
    status: merged.status,
    text:
      merged.status === 'add'
        ? `правило ${what} → ${params.tag} (${ruleOrdinal(merged.index)})`
        : `правило ${what} → ${params.tag} — уже есть`,
  })

  const notes =
    params.domains.length === 0
      ? [
          {
            text: 'Правило без условий заберёт весь трафик — поставьте его ниже частных правил, если нужно исключение.',
          },
        ]
      : []
  return { config: merged.config, changes, notes }
}

import type { ConfigProfile, PanelInboundDetail, RemnawavePort } from './types.js'

export class RemnawaveError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public hint?: string,
  ) {
    super(message)
    this.name = 'RemnawaveError'
  }
}

/**
 * Панель Remnawave обслуживает только запросы, пришедшие через её reverse
 * proxy: без `X-Forwarded-Proto: https` и `X-Forwarded-For` она молча рвёт
 * соединение, не отдав ни байта. Проверено на живой установке 2026-07-27:
 * заголовки нужны ОБА, значение `http` не подходит, `Host` роли не играет.
 *
 * Подделывать эти заголовки мы не будем — они существуют ровно затем, чтобы
 * закрыть прямой доступ к контейнеру. Вместо этого объясняем симптом: сам по
 * себе «other side closed» на решение не наводит.
 */
export function hintForNetworkError(baseUrl: string, cause: string): string | undefined {
  const silentClose = /other side closed|UND_ERR_SOCKET|ECONNRESET|socket hang up/i.test(cause)
  if (!silentClose || !baseUrl.startsWith('http://')) return undefined
  return (
    'Похоже, REMNAWAVE_URL указывает на внутренний адрес панели. Панель отвечает только ' +
    'через свой reverse proxy, а на прямое обращение молча закрывает соединение. ' +
    'Укажите публичный https-адрес панели — тот же, по которому вы открываете её в браузере.'
  )
}

/**
 * Разворачивает цепочку `cause`. `fetch` в Node на любую сетевую беду отвечает
 * одинаковым `TypeError: fetch failed`, а настоящая причина (ECONNREFUSED,
 * EAI_AGAIN, обрыв TLS) лежит глубже. Без разворота диагностика упирается в
 * сообщение, которое не говорит ничего.
 */
export function describeCause(err: unknown, depth = 4): string {
  const parts: string[] = []
  let cur: unknown = err
  for (let i = 0; i <= depth && cur; i++) {
    const e = cur as { message?: string; code?: string; cause?: unknown }
    const text = e.message ?? String(cur)
    const code = e.code ? ` (${e.code})` : ''
    const line = `${text}${code}`
    if (parts[parts.length - 1] !== line) parts.push(line)
    cur = e.cause
  }
  return parts.join(' ← ')
}

interface ClientOptions {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
}

export class RemnawaveClient implements RemnawavePort {
  constructor(private opts: ClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const doFetch = this.opts.fetchImpl ?? fetch
    let res: Response
    try {
      res = await doFetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.opts.token}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      const cause = describeCause(err)
      throw new RemnawaveError(
        502,
        'Панель Remnawave недоступна',
        cause,
        hintForNetworkError(this.opts.baseUrl, cause),
      )
    }
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    if (!res.ok) {
      const message =
        (json as { message?: string } | undefined)?.message ?? `Панель ответила ${res.status}`
      throw new RemnawaveError(res.status, message, json ?? text)
    }
    return json as T
  }

  async listProfiles(): Promise<ConfigProfile[]> {
    const r = await this.request<{ response: { configProfiles: ConfigProfile[] } }>(
      'GET',
      '/api/config-profiles',
    )
    return r.response.configProfiles
  }

  async getProfile(uuid: string): Promise<ConfigProfile> {
    const r = await this.request<{ response: ConfigProfile }>(
      'GET',
      `/api/config-profiles/${uuid}`,
    )
    return r.response
  }

  async createProfile(name: string, config: unknown): Promise<ConfigProfile> {
    const r = await this.request<{ response: ConfigProfile }>('POST', '/api/config-profiles', {
      name,
      config,
    })
    return r.response
  }

  async updateProfile(input: {
    uuid: string
    name?: string
    config?: unknown
  }): Promise<ConfigProfile> {
    const r = await this.request<{ response: ConfigProfile }>(
      'PATCH',
      '/api/config-profiles',
      input,
    )
    return r.response
  }

  async deleteProfile(uuid: string): Promise<void> {
    await this.request<{ response: { isDeleted: boolean } }>(
      'DELETE',
      `/api/config-profiles/${uuid}`,
    )
  }

  async getNodes(): Promise<unknown[]> {
    const r = await this.request<{ response: unknown[] }>('GET', '/api/nodes')
    return r.response
  }

  async getSquads(): Promise<unknown[]> {
    const r = await this.request<{ response: { internalSquads: unknown[] } }>(
      'GET',
      '/api/internal-squads',
    )
    return r.response.internalSquads
  }

  async getProfileInbounds(uuid: string): Promise<PanelInboundDetail[]> {
    const r = await this.request<{ response: { inbounds: PanelInboundDetail[] } }>(
      'GET',
      `/api/config-profiles/${uuid}/inbounds`,
    )
    return r.response.inbounds
  }
}

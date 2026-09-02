import type {
  ConfigProfile,
  PanelInboundDetail,
  RemnawavePort,
  SubscriptionTemplate,
  TemplateType,
} from './types.js'

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
 * Токен панели живёт 30 дней, после чего она отвечает 401 на всё подряд. Отдать
 * этот статус браузеру как есть нельзя: фронтенд трактует любой 401 как «сессия
 * редактора истекла» и уводит на /login, где вход ничего не чинит — получается
 * петля без единого намёка на настоящую причину. Поэтому 401/403 от панели
 * становятся 502: сломан вышестоящий сервис, а не сессия пользователя.
 */
export const PANEL_TOKEN_HINT =
  'Панель не приняла REMNAWAVE_TOKEN: срок его действия истёк (токен выдаётся на 30 дней) ' +
  'либо он отозван. Выпустите новый API-токен в панели и пропишите его в .env, ' +
  'затем перезапустите редактор.'

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

/**
 * У панели два формата ошибки 400: RemnawaveBadRequestErrorDto (просто message)
 * и RemnawaveValidationErrorDto с errors[] — там лежат пути полей, которые не
 * прошли проверку. В v3 панель валидирует и сам Xray-конфиг, поэтому верхний
 * message («Validation failed») перестал что-либо называть.
 */
export function describePanelError(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) return undefined
  const body = json as { message?: unknown; errors?: unknown }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const lines = body.errors
      .map((e) => {
        const item = e as { path?: unknown; message?: unknown }
        const path = Array.isArray(item.path) ? item.path.join('.') : ''
        const message = typeof item.message === 'string' ? item.message : ''
        if (path === '' && message === '') return ''
        return path === '' ? message : `${path} — ${message}`
      })
      .filter((line) => line !== '')
    if (lines.length > 0) return lines.join('; ')
  }
  return typeof body.message === 'string' ? body.message : undefined
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
      const message = describePanelError(json) ?? `Панель ответила ${res.status}`
      if (res.status === 401 || res.status === 403) {
        throw new RemnawaveError(502, 'Панель Remnawave отклонила токен', message, PANEL_TOKEN_HINT)
      }
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

  // v3 отвечает 204 без тела, 2.8 — 200 с {response:{isDeleted}}: тело не читаем,
  // и метод одинаково работает с обеими версиями панели
  async deleteProfile(uuid: string): Promise<void> {
    await this.request<void>('DELETE', `/api/config-profiles/${uuid}`)
  }

  /** Конфиг профиля с пользователями, которых панель инжектит при раздаче на ноды */
  async getComputedConfig(uuid: string): Promise<unknown> {
    const r = await this.request<{ response: { config: unknown } }>(
      'GET',
      `/api/config-profiles/${uuid}/computed-config`,
    )
    return r.response.config
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

  // Ручки шаблонов зеркалят config-profiles: PATCH идёт на коллекцию, uuid — в теле.
  // Слеш в конце путей коллекций взят из официального контракта, не из догадки.
  async listTemplates(): Promise<SubscriptionTemplate[]> {
    const r = await this.request<{ response: { total: number; templates: SubscriptionTemplate[] } }>(
      'GET',
      '/api/subscription-templates/',
    )
    return r.response.templates
  }

  async getTemplate(uuid: string): Promise<SubscriptionTemplate> {
    const r = await this.request<{ response: SubscriptionTemplate }>(
      'GET',
      `/api/subscription-templates/${uuid}`,
    )
    return r.response
  }

  async createTemplate(name: string, templateType: TemplateType): Promise<SubscriptionTemplate> {
    const r = await this.request<{ response: SubscriptionTemplate }>(
      'POST',
      '/api/subscription-templates/',
      { name, templateType },
    )
    return r.response
  }

  async updateTemplate(input: {
    uuid: string
    name?: string
    templateJson?: unknown
  }): Promise<SubscriptionTemplate> {
    const r = await this.request<{ response: SubscriptionTemplate }>(
      'PATCH',
      '/api/subscription-templates/',
      input,
    )
    return r.response
  }

  // Тело не читаем — как и у deleteProfile: панель отвечает то 200 с телом, то 204
  async deleteTemplate(uuid: string): Promise<void> {
    await this.request<void>('DELETE', `/api/subscription-templates/${uuid}`)
  }
}

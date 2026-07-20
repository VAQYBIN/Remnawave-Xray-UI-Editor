import type { ConfigProfile, RemnawavePort } from './types.js'

export class RemnawaveError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'RemnawaveError'
  }
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
      throw new RemnawaveError(502, 'Панель Remnawave недоступна', String(err))
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
}

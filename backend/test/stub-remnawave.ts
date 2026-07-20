import { randomUUID } from 'node:crypto'
import { RemnawaveError } from '../src/remnawave/client.js'
import type { ConfigProfile, RemnawavePort } from '../src/remnawave/types.js'

export function makeProfile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    uuid: randomUUID(),
    viewPosition: 0,
    name: 'Test Profile',
    config: { inbounds: [], outbounds: [] },
    inbounds: [],
    nodes: [],
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
    ...overrides,
  }
}

export function makeStubRemnawave(
  initial: ConfigProfile[] = [],
): RemnawavePort & { profiles: ConfigProfile[] } {
  const profiles = [...initial]
  const find = (uuid: string) => {
    const p = profiles.find((x) => x.uuid === uuid)
    if (!p) throw new RemnawaveError(404, 'Config profile not found')
    return p
  }
  return {
    profiles,
    async listProfiles() {
      return profiles
    },
    async getProfile(uuid) {
      return find(uuid)
    },
    async createProfile(name, config) {
      const p = makeProfile({ name, config })
      profiles.push(p)
      return p
    },
    async updateProfile({ uuid, name, config }) {
      const p = find(uuid)
      if (name !== undefined) p.name = name
      if (config !== undefined) p.config = config
      p.updatedAt = new Date().toISOString()
      return p
    },
    async deleteProfile(uuid) {
      const i = profiles.findIndex((x) => x.uuid === uuid)
      if (i === -1) throw new RemnawaveError(404, 'Config profile not found')
      profiles.splice(i, 1)
    },
    async getNodes() {
      return [{ uuid: 'node-1', name: 'DE-1', countryCode: 'DE' }]
    },
    async getSquads() {
      return [{ uuid: 'squad-1', name: 'Default' }]
    },
    async getProfileInbounds(uuid) {
      find(uuid)
      return [
        { uuid: 'pi-1', profileUuid: uuid, tag: 'vless-in', type: 'vless', network: 'tcp', security: 'none', port: 443, rawInbound: {}, activeSquads: ['squad-1'] },
      ]
    },
  }
}

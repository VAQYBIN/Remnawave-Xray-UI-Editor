import { randomUUID } from 'node:crypto'
import { RemnawaveError } from '../src/remnawave/client.js'
import type { ConfigProfile, RemnawavePort, SubscriptionTemplate, TemplateType } from '../src/remnawave/types.js'

export function makeProfile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    uuid: randomUUID(),
    viewPosition: 0,
    name: 'Test Profile',
    // Панель 3.4.0 добавила профилям теги — держим стаб похожим на живой ответ
    tags: [],
    config: { inbounds: [], outbounds: [] },
    inbounds: [],
    nodes: [],
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
    ...overrides,
  }
}

export function makeStubTemplate(
  overrides: Partial<SubscriptionTemplate> = {},
): SubscriptionTemplate {
  return {
    uuid: randomUUID(),
    viewPosition: 0,
    name: 'Test Template',
    tags: [],
    templateType: 'XRAY_JSON',
    templateJson: { outbounds: [{ tag: 'direct', protocol: 'freedom' }] },
    encodedTemplateYaml: null,
    ...overrides,
  }
}

export function makeStubRemnawave(
  initial: ConfigProfile[] = [],
  templates: SubscriptionTemplate[] = [],
): RemnawavePort & { profiles: ConfigProfile[]; templates: SubscriptionTemplate[] } {
  const profiles = [...initial]
  const find = (uuid: string) => {
    const p = profiles.find((x) => x.uuid === uuid)
    if (!p) throw new RemnawaveError(404, 'Config profile not found')
    return p
  }
  return {
    profiles,
    templates,
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
    async getComputedConfig(uuid) {
      const p = find(uuid)
      return p.config
    },
    async listTemplates() {
      return templates
    },
    async getTemplate(uuid) {
      const t = templates.find((x) => x.uuid === uuid)
      if (!t) throw new RemnawaveError(404, 'Subscription template not found')
      return t
    },
    async createTemplate(name, templateType) {
      const t = makeStubTemplate({ name, templateType, templateJson: null })
      templates.push(t)
      return t
    },
    async updateTemplate({ uuid, name, templateJson }) {
      const t = templates.find((x) => x.uuid === uuid)
      if (!t) throw new RemnawaveError(404, 'Subscription template not found')
      if (name !== undefined) t.name = name
      if (templateJson !== undefined) t.templateJson = templateJson
      return t
    },
    async deleteTemplate(uuid) {
      const i = templates.findIndex((x) => x.uuid === uuid)
      if (i === -1) throw new RemnawaveError(404, 'Subscription template not found')
      templates.splice(i, 1)
    },
  }
}

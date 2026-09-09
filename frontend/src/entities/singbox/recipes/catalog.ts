// Каталог источников наборов правил. Ссылки статические и только проверенные:
// бэкенд их не скачивает, они уходят в документ пользователя, и ссылка на
// несуществующий файл сломала бы клиенту загрузку конфига.

export interface RuleSetSource {
  id: string
  tag: string
  title: string
  url: string
  kind: 'domain' | 'ip'
}

const GEOSITE = (name: string) => `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geosite/${name}.srs`
const GEOIP = (name: string) => `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/geoip/${name}.srs`

export const RULE_SET_CATALOG: RuleSetSource[] = [
  { id: 'geosite-category-ads-all', tag: 'geosite-category-ads-all', title: 'Реклама (category-ads-all)', url: GEOSITE('category-ads-all'), kind: 'domain' },
  { id: 'geosite-private', tag: 'geosite-private', title: 'Локальные домены', url: GEOSITE('private'), kind: 'domain' },
  { id: 'geoip-private', tag: 'geoip-private', title: 'Локальные подсети', url: GEOIP('private'), kind: 'ip' },
  { id: 'geosite-ru', tag: 'geosite-ru', title: 'Домены РФ (category-ru)', url: GEOSITE('category-ru'), kind: 'domain' },
  { id: 'geoip-ru', tag: 'geoip-ru', title: 'Подсети РФ', url: GEOIP('ru'), kind: 'ip' },
  { id: 'geosite-youtube', tag: 'geosite-youtube', title: 'YouTube', url: GEOSITE('youtube'), kind: 'domain' },
  { id: 'geosite-telegram', tag: 'geosite-telegram', title: 'Telegram (домены)', url: GEOSITE('telegram'), kind: 'domain' },
  { id: 'geoip-telegram', tag: 'geoip-telegram', title: 'Telegram (подсети)', url: GEOIP('telegram'), kind: 'ip' },
  { id: 'geosite-discord', tag: 'geosite-discord', title: 'Discord', url: GEOSITE('discord'), kind: 'domain' },
  { id: 'geosite-whatsapp', tag: 'geosite-whatsapp', title: 'WhatsApp', url: GEOSITE('whatsapp'), kind: 'domain' },
  { id: 'geosite-tiktok', tag: 'geosite-tiktok', title: 'TikTok', url: GEOSITE('tiktok'), kind: 'domain' },
  { id: 'geosite-netflix', tag: 'geosite-netflix', title: 'Netflix', url: GEOSITE('netflix'), kind: 'domain' },
  { id: 'geosite-openai', tag: 'geosite-openai', title: 'OpenAI', url: GEOSITE('openai'), kind: 'domain' },
  { id: 'geosite-google', tag: 'geosite-google', title: 'Google', url: GEOSITE('google'), kind: 'domain' },
]

export function sourceById(id: string): RuleSetSource | undefined {
  return RULE_SET_CATALOG.find((s) => s.id === id)
}

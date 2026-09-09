// Каталог источников наборов правил Mihomo. Ссылки статические и только
// проверенные — бэкенд их не скачивает, ссылка уходит прямо в документ
// пользователя, и опечатка в ней сломала бы клиенту загрузку конфига. Все 14
// ссылок проверены 2026-09-09 (`curl -sI`, ответ 200). Имена записей — как у
// каталога sing-box (`entities/singbox/recipes/catalog.ts`), чтобы один и тот
// же набор в двух шаблонах назывался одинаково.

export interface RuleSetSource {
  id: string
  name: string
  title: string
  url: string
  behavior: 'domain' | 'ipcidr'
}

const GEOSITE = (name: string) => `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/${name}.mrs`
const GEOIP = (name: string) => `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/${name}.mrs`

export const RULE_SET_CATALOG: RuleSetSource[] = [
  { id: 'geosite-category-ads-all', name: 'geosite-category-ads-all', title: 'Реклама (category-ads-all)', url: GEOSITE('category-ads-all'), behavior: 'domain' },
  { id: 'geosite-private', name: 'geosite-private', title: 'Локальные домены', url: GEOSITE('private'), behavior: 'domain' },
  { id: 'geoip-private', name: 'geoip-private', title: 'Локальные подсети', url: GEOIP('private'), behavior: 'ipcidr' },
  { id: 'geosite-ru', name: 'geosite-ru', title: 'Домены РФ (category-ru)', url: GEOSITE('category-ru'), behavior: 'domain' },
  { id: 'geosite-youtube', name: 'geosite-youtube', title: 'YouTube', url: GEOSITE('youtube'), behavior: 'domain' },
  { id: 'geosite-telegram', name: 'geosite-telegram', title: 'Telegram (домены)', url: GEOSITE('telegram'), behavior: 'domain' },
  { id: 'geosite-discord', name: 'geosite-discord', title: 'Discord', url: GEOSITE('discord'), behavior: 'domain' },
  { id: 'geosite-whatsapp', name: 'geosite-whatsapp', title: 'WhatsApp', url: GEOSITE('whatsapp'), behavior: 'domain' },
  { id: 'geosite-tiktok', name: 'geosite-tiktok', title: 'TikTok', url: GEOSITE('tiktok'), behavior: 'domain' },
  { id: 'geosite-netflix', name: 'geosite-netflix', title: 'Netflix', url: GEOSITE('netflix'), behavior: 'domain' },
  { id: 'geosite-openai', name: 'geosite-openai', title: 'OpenAI', url: GEOSITE('openai'), behavior: 'domain' },
  { id: 'geosite-google', name: 'geosite-google', title: 'Google', url: GEOSITE('google'), behavior: 'domain' },
  { id: 'geoip-ru', name: 'geoip-ru', title: 'Подсети РФ', url: GEOIP('ru'), behavior: 'ipcidr' },
  { id: 'geoip-telegram', name: 'geoip-telegram', title: 'Telegram (подсети)', url: GEOIP('telegram'), behavior: 'ipcidr' },
]

export function sourceById(id: string): RuleSetSource | undefined {
  return RULE_SET_CATALOG.find((s) => s.id === id)
}

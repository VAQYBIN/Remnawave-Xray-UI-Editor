// Единая точка входа в модель Mihomo-шаблона. Модули писались параллельно и
// реэкспорт был намеренно отложен до последней задачи плана, чтобы не сталкивать
// правки нескольких исполнителей в одном файле.
//
// Граф Mihomo (`entities/graph/mihomo`) сюда не входит: это отдельный слой со
// своей структурой, как и граф Xray не реэкспортируется из `entities/xray`.

export * from './parse'
export * from './marker'
export * from './rules'
export * from './groups'
export * from './resolve'
export * from './validate'
export * from './edits'
export * from './docSchema'
export * from './locate'
export * from './search'

// `inject.ts` реэкспортирует `INJECT_MARKER` из `marker.ts` (единственный
// владелец константы) — исключаем его здесь, чтобы `export *` не столкнул
// одно и то же имя из двух модулей.
export {
  hasRootMarker,
  groupGetsHosts,
  panelInjectsHosts,
  conflictingKeys,
} from './inject'

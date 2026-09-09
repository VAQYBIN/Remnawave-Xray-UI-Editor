// Единая точка входа в модель Mihomo-шаблона. Модули писались параллельно и
// реэкспорт был намеренно отложен до последней задачи плана, чтобы не сталкивать
// правки нескольких исполнителей в одном файле.
//
// Граф Mihomo (`entities/graph/mihomo`) сюда не входит: это отдельный слой со
// своей структурой, как и граф Xray не реэкспортируется из `entities/xray`.

export * from './parse'
export * from './rules'
export * from './groups'
export * from './resolve'
export * from './validate'
export * from './edits'
export * from './locate'
export * from './search'
export * from './write'
export * from './refs'
export * from './starters'

export {
  groupGetsHosts,
  groupTakesHosts,
  panelInjectsHosts,
  conflictingKeys,
} from './inject'

// Единая точка входа в модель шаблона sing-box. Модули писались параллельно, и
// реэкспорт был намеренно отложен: собранный после всех задач, он не сталкивает
// правки нескольких исполнителей в одном файле.
//
// Графа здесь нет и не будет: у Xray и Mihomo он тоже живёт отдельным слоем в
// `entities/graph`, и втянуть его сюда значило бы завести вторую точку входа в
// то же знание.

export * from './types'
export * from './parse'
export * from './outbounds'
export * from './rules'
export * from './docSchema'
export * from './validate'
export * from './trace'
export * from './docPath'
export * from './search'
export * from './starters'

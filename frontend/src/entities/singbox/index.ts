// Единая точка входа в модель шаблона sing-box. Модули писались параллельно, и
// реэкспорт был намеренно отложен: собранный после всех задач, он не сталкивает
// правки нескольких исполнителей в одном файле.
//
// Графа у sing-box пока нет вовсе — он в плане 2, вместе со всем интерфейсом,
// и реэкспортироваться отсюда не будет: у Xray и Mihomo граф тоже живёт
// отдельным слоем в `entities/graph`.

export * from './types'
export * from './parse'
export * from './outbounds'
export * from './rules'
export * from './docSchema'
export * from './validate'
export * from './trace'
export * from './docPath'
export * from './search'

// Форма правила маршрутизации sing-box: главные условия, действие и цель
// руками; остальные матчеры и поля действия — из схемы по значению action.

import { ROUTE_RULE_ACTION_VALUES, ROUTE_RULE_FIELDS, type SingboxRule } from '../../entities/singbox'
import type { DocOp, DocWriter, RefKind, SchemaPath } from '../../shared/schema'
import { type SelectOption } from '../../shared/ui'
import { MultiSelectField, SelectField, StringListField, TextField, TriStateField } from './fields'
import { SchemaForm } from './schema/SchemaForm'

const SHOWN = ['action', 'outbound', 'domain', 'domain_suffix', 'domain_keyword', 'domain_regex', 'ip_cidr', 'ip_is_private', 'port', 'port_range', 'protocol', 'clash_mode', 'rule_set', 'inbound']

/** Отсутствующее действие означает маршрут — в списке это отдельного значения не требует */
const DEFAULT_ACTION = 'route'
const ACTION_OPTIONS: SelectOption[] = ROUTE_RULE_ACTION_VALUES.map((e) => ({ value: e.value, label: e.value }))
/** Действия с целью-выходом: route и bypass */
const WITH_OUTBOUND = new Set(['route', 'bypass'])

/** Теги документа плюс значения из самого правила: битая ссылка должна быть видима и снимаема из формы */
function tagOptions(known: string[], selected: string[]): SelectOption[] {
  const all = [...known]
  for (const t of selected) if (!all.includes(t)) all.push(t)
  return all.map((v) => ({ value: v, label: v }))
}

const strings = (raw: unknown): string[] | undefined => (Array.isArray(raw) ? raw.map((v) => String(v)) : undefined)

export function SingboxRuleForm({ value, path, writer, refs }: {
  value: SingboxRule
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const action = typeof value.action === 'string' ? value.action : DEFAULT_ACTION
  const outbound = typeof value.outbound === 'string' ? value.outbound : ''
  const at = (key: string): SchemaPath => [...path, key]
  const setOrRemove = (key: string, next: unknown) =>
    writer.apply([next === undefined || next === '' ? { op: 'remove', path: at(key) } : { op: 'set', path: at(key), value: next }])

  const listRow = (key: string, label: string, hint?: string, placeholder?: string) => (
    <StringListField key={key} label={label} hint={hint} placeholder={placeholder} value={strings(value[key])} onChange={(v) => setOrRemove(key, v)} />
  )

  function changeAction(v: string) {
    // Ядро при нетерминальном или не-маршрутном действии поле outbound не
    // читает. Держать его в документе значит показывать связь, которой нет, —
    // поэтому смена действия его убирает, а не прячет
    const ops: DocOp[] = [v === DEFAULT_ACTION ? { op: 'remove', path: at('action') } : { op: 'set', path: at('action'), value: v }]
    if (!WITH_OUTBOUND.has(v) && value.outbound !== undefined) ops.push({ op: 'remove', path: at('outbound') })
    writer.apply(ops)
  }

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>Правила проверяются сверху вниз — срабатывает первое совпавшее.</p>
      <SelectField label="Действие" hint={ROUTE_RULE_ACTION_VALUES.find((e) => e.value === action)?.doc} value={action} options={ACTION_OPTIONS} onChange={changeAction} />
      {WITH_OUTBOUND.has(action) && (
        <SelectField
          label="Выход"
          hint="Тег выхода, в который уйдёт совпавшее соединение."
          value={outbound}
          options={[{ value: '', label: '— не задан —' }, ...tagOptions(refs.outbound ?? [], outbound === '' ? [] : [outbound])]}
          onChange={(v) => setOrRemove('outbound', v)}
        />
      )}
      {listRow('domain', 'Домен (точное совпадение)', undefined, 'example.com')}
      {listRow('domain_suffix', 'Суффикс домена', 'Без ведущей точки совпадает и сам домен, и его поддомены; с точкой — только поддомены.', '.example.com')}
      {listRow('domain_keyword', 'Подстрока в домене')}
      {listRow('domain_regex', 'Регулярное выражение по домену')}
      {listRow('ip_cidr', 'IP назначения', 'IP или подсеть: 10.0.0.0/8', '10.0.0.0/8')}
      <TriStateField label="Частный адрес назначения" hint="Совпадает, когда адрес назначения из частного диапазона." value={typeof value.ip_is_private === 'boolean' ? value.ip_is_private : undefined} onChange={(v) => (v === undefined ? setOrRemove('ip_is_private', undefined) : writer.apply([{ op: 'set', path: at('ip_is_private'), value: v }]))} />
      <StringListField
        label="Порт назначения"
        hint="По одному порту в строке."
        placeholder="443"
        value={strings(value.port)}
        // Ядро ждёт в `port` числа, а поле отдаёт строки: числовую строку приводим обратно; не число пишем как есть — подменять набранное форма не вправе
        onChange={(v) => setOrRemove('port', v?.map((s) => (/^\d+$/.test(s) ? Number(s) : s)))}
      />
      {listRow('port_range', 'Диапазон портов', 'Например 1000:2000', '1000:2000')}
      <MultiSelectField label="Наборы правил" hint="Содержимое набора лежит по ссылке — редактор его не скачивает." options={tagOptions(refs['rule-set'] ?? [], strings(value.rule_set) ?? [])} value={strings(value.rule_set)} onChange={(v) => setOrRemove('rule_set', v)} />
      {listRow('inbound', 'Входы (inbound)', 'Теги входов, с которых пришло соединение.')}
      {listRow('protocol', 'Протокол', 'Определяется сниффингом — редактор его предсказать не может.')}
      <TextField label="Режим Clash" hint="Режим, выбранный в клиенте через Clash API. Документом не задаётся." value={typeof value.clash_mode === 'string' ? value.clash_mode : undefined} onChange={(v) => setOrRemove('clash_mode', v)} />
      <SchemaForm fields={ROUTE_RULE_FIELDS} value={value as Record<string, unknown>} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}

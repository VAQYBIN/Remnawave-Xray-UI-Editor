// Форма DNS-правила: действие и сервер руками, матчеры и поля действия — из
// схемы. Отдельная от формы правила маршрута намеренно: цель здесь — сервер,
// а не выход, и действия свои.

import { DNS_RULE_ACTION_VALUES, DNS_RULE_FIELDS, type SingboxRule } from '../../entities/singbox'
import type { DocOp, DocWriter, RefKind, SchemaPath } from '../../shared/schema'
import { SelectField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeOptions } from './schema/typeSelect'

const SHOWN = ['action', 'server']
const DEFAULT_ACTION = 'route'
/** Действия с целью-сервером: route и evaluate */
const WITH_SERVER = new Set(['route', 'evaluate'])

export function SingboxDnsRuleForm({ value, path, writer, refs }: {
  value: SingboxRule
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
}) {
  const action = typeof value.action === 'string' ? value.action : DEFAULT_ACTION
  const server = typeof value.server === 'string' ? value.server : ''
  const at = (key: string): SchemaPath => [...path, key]

  function changeAction(v: string) {
    const ops: DocOp[] = [v === DEFAULT_ACTION ? { op: 'remove', path: at('action') } : { op: 'set', path: at('action'), value: v }]
    if (!WITH_SERVER.has(v) && value.server !== undefined) ops.push({ op: 'remove', path: at('server') })
    writer.apply(ops)
  }

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>Правила DNS проверяются сверху вниз — срабатывает первое совпавшее.</p>
      <SelectField label="Действие" hint={DNS_RULE_ACTION_VALUES.find((e) => e.value === action)?.doc} value={action} options={typeOptions(DNS_RULE_ACTION_VALUES, action)} onChange={changeAction} />
      {WITH_SERVER.has(action) && (
        <SelectField
          label="Сервер"
          hint="Тег DNS-сервера, которому уйдёт запрос."
          value={server}
          options={typeOptions((refs['dns-server'] ?? []).map((value) => ({ value })), server, true)}
          onChange={(v) => writer.apply([v === '' ? { op: 'remove', path: at('server') } : { op: 'set', path: at('server'), value: v }])}
        />
      )}
      <SchemaForm fields={DNS_RULE_FIELDS} value={value as Record<string, unknown>} path={path} writer={writer} refs={refs} skip={SHOWN} />
    </>
  )
}

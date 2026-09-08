// Форма правила маршрутизации sing-box: условия, действие и цель.
//
// Правка идёт по модели: копия, мутация копии, `onChange(next)` — как у
// `RuleForm` в редакторе Xray. Ключи, которых форма не знает, лежат в копии
// нетронутыми: схема разбора сквозная, и терять их при правке нельзя.

import { fieldFor, type SingboxRule } from '../../entities/singbox'
import { type SelectOption } from '../../shared/ui'
import { CheckboxField, MultiSelectField, SelectField, StringListField, TextField } from './fields'
import { SingboxExtraFields } from './SingboxExtraFields'

// skip — ровно то, что нарисовано ниже руками: второй раз показывать ключ
// незачем. Список назван поимённо, а не собран из JSX: собранный расходился бы
// с разметкой молча, стоило убрать одно поле
const SHOWN = [
  'action',
  'outbound',
  'domain',
  'domain_suffix',
  'domain_keyword',
  'domain_regex',
  'ip_cidr',
  'ip_is_private',
  'port',
  'port_range',
  'protocol',
  'clash_mode',
  'rule_set',
  'inbound',
]

/** Отсутствующее действие означает маршрут — в списке это отдельного значения не требует */
const DEFAULT_ACTION = 'route'

const ACTION_OPTIONS: SelectOption[] = (fieldFor('route-rule', 'action')?.enum ?? []).map((e) => ({
  value: e.value,
  label: e.value,
}))

/** Теги конфига плюс значения из самого правила: битая ссылка должна быть
 *  видима и снимаема из формы, а не пропадать молча */
function tagOptions(configTags: string[], selected: string[]): SelectOption[] {
  const all = [...configTags]
  for (const t of selected) if (!all.includes(t)) all.push(t)
  return all.map((v) => ({ value: v, label: v }))
}

function strings(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? raw.map((v) => String(v)) : undefined
}

export function SingboxRuleForm({
  value,
  outboundTags,
  ruleSetTags,
  onChange,
}: {
  value: SingboxRule
  outboundTags: string[]
  ruleSetTags: string[]
  onChange: (next: SingboxRule) => void
}) {
  const action = typeof value.action === 'string' ? value.action : DEFAULT_ACTION
  const outbound = typeof value.outbound === 'string' ? value.outbound : ''
  const selectedSets = strings(value.rule_set) ?? []

  function patch(mut: (draft: SingboxRule) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  /** Список строк: пустой снимает ключ — `domain: []` и отсутствующее условие
   *  для ядра не одно и то же, и копить первые из-за очищенного поля нельзя */
  const listRow = (key: string, label: string, hint?: string, placeholder?: string) => (
    <StringListField
      key={key}
      label={label}
      hint={hint}
      placeholder={placeholder}
      value={strings(value[key])}
      onChange={(v) => patch((n) => { if (v === undefined) delete n[key]; else n[key] = v })}
    />
  )

  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Правила проверяются сверху вниз — срабатывает первое совпавшее.
      </p>
      <SelectField
        label="Действие"
        hint={fieldFor('route-rule', 'action')?.doc}
        value={action}
        options={ACTION_OPTIONS}
        onChange={(v) =>
          patch((n) => {
            // Ядро при нетерминальном или не-маршрутном действии поле outbound
            // не читает. Держать его в документе значит показывать связь,
            // которой нет, — поэтому смена действия его убирает, а не прячет
            if (v === DEFAULT_ACTION) delete n.action
            else {
              n.action = v
              delete n.outbound
            }
          })
        }
      />
      {action === DEFAULT_ACTION && (
        <SelectField
          label="Выход"
          hint="Тег выхода, в который уйдёт совпавшее соединение."
          value={outbound}
          options={[
            { value: '', label: '— не задан —' },
            ...tagOptions(outboundTags, outbound === '' ? [] : [outbound]),
          ]}
          onChange={(v) => patch((n) => { if (v === '') delete n.outbound; else n.outbound = v })}
        />
      )}
      {listRow('domain', 'Домен (точное совпадение)', undefined, 'example.com')}
      {listRow(
        'domain_suffix',
        'Суффикс домена',
        'Без ведущей точки совпадает и сам домен, и его поддомены; с точкой — только поддомены.',
        '.example.com',
      )}
      {listRow('domain_keyword', 'Подстрока в домене')}
      {listRow('domain_regex', 'Регулярное выражение по домену')}
      {listRow('ip_cidr', 'IP назначения', 'IP или подсеть: 10.0.0.0/8', '10.0.0.0/8')}
      <CheckboxField
        label="Частный адрес назначения"
        hint="Совпадает, когда адрес назначения из частного диапазона."
        value={value.ip_is_private === true ? true : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.ip_is_private; else n.ip_is_private = v })}
      />
      <StringListField
        label="Порт назначения"
        hint="По одному порту в строке."
        placeholder="443"
        value={strings(value.port)}
        // Ядро ждёт в `port` числа, а поле отдаёт строки: числовую строку
        // приводим обратно, иначе сохранённый документ ядро не примет. Не число
        // пишем как есть — подменять набранное форма не вправе
        onChange={(v) =>
          patch((n) => {
            if (v === undefined) delete n.port
            else n.port = v.map((s) => (/^\d+$/.test(s) ? Number(s) : s))
          })
        }
      />
      {listRow('port_range', 'Диапазон портов', 'Например 1000:2000', '1000:2000')}
      <MultiSelectField
        label="Наборы правил"
        hint="Содержимое набора лежит по ссылке — редактор его не скачивает."
        options={tagOptions(ruleSetTags, selectedSets)}
        value={strings(value.rule_set)}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.rule_set; else n.rule_set = v })}
      />
      {listRow('inbound', 'Входы (inbound)', 'Теги входов, с которых пришло соединение.')}
      {listRow('protocol', 'Протокол', 'Определяется сниффингом — редактор его предсказать не может.')}
      <TextField
        label="Режим Clash"
        hint="Режим, выбранный в клиенте через Clash API. Документом не задаётся."
        value={typeof value.clash_mode === 'string' ? value.clash_mode : undefined}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.clash_mode; else n.clash_mode = v })}
      />
      <SingboxExtraFields
        section="route-rule"
        value={value}
        skip={SHOWN}
        onChange={(next) => onChange(next as SingboxRule)}
      />
    </>
  )
}

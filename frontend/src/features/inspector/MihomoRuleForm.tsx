// Форма правила Mihomo. У правила поля не «ключ → скаляр», а разбор одной
// строки, поэтому форма здесь своя, а не общая с секциями: строка собирается
// заново целиком и уходит одной правкой через draft.replaceRule.

import { useId, useState } from 'react'
import {
  BUILTIN_TARGETS,
  RULE_MODIFIERS,
  RULE_TYPES,
  formatRule,
  groupsOf,
  providersOf,
  rulesOf,
  subRuleNames,
  type MihomoDoc,
  type MihomoRule,
} from '../../entities/mihomo'
import { Checkbox, TextInput, type SelectOption } from '../../shared/ui'
import type { MihomoDraft } from '../editor/useMihomoDraft'
import { Field, SelectField } from './fields'

/**
 * Типы без значения: сразу после типа идёт цель. Список зеркалит NO_PAYLOAD в
 * entities/mihomo/rules.ts — там он не экспортирован, а форма обязана знать
 * ответ ДО разбора: у только что выбранного типа значения ещё нет.
 */
const NO_PAYLOAD = new Set(['MATCH'])

function optionsOf(names: readonly string[], current: string): SelectOption[] {
  const options = names.map((n) => ({ value: n, label: n }))
  // Цель, которой в документе нет, — обычное дело: имя подставленного панелью
  // хоста редактор не знает. Молча заменять его первым вариантом списка нельзя.
  if (current !== '' && !options.some((o) => o.value === current)) {
    return [{ value: current, label: current }, ...options]
  }
  return options
}

/**
 * Строка значения с локальным состоянием: набранное держится в форме, а не
 * перечитывается из документа на каждый символ — правка может быть отклонена
 * писателем, и тогда поле обязано показывать набранное, а не то, что осталось
 * в тексте. Изменение документа (undo, восстановление версии) перебивает.
 */
function TextRow({
  controlId,
  label,
  value,
  hint,
  onCommit,
}: {
  controlId: string
  label: string
  value: string
  hint?: string
  onCommit: (next: string) => void
}) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(value)
  }
  return (
    <Field label={label} hint={hint} controlId={controlId}>
      <TextInput
        id={controlId}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onCommit(e.target.value)
        }}
      />
    </Field>
  )
}

function RuleFields({
  md,
  index,
  rule,
  draft,
}: {
  md: MihomoDoc
  index: number
  rule: MihomoRule
  draft: MihomoDraft
}) {
  const payloadId = useId()
  const targetId = useId()
  // Имя хоста, подставленного панелью, редактор не знает и предугадать не может,
  // поэтому цель по умолчанию — свободный ввод, а список известных имён живёт
  // за снятой галочкой. Умолчание не зависит от текущего значения: одно и то же
  // правило иначе выглядело бы по-разному в двух документах.
  const [customTarget, setCustomTarget] = useState(true)

  const isSubRule = rule.type === 'SUB-RULE'
  const commit = (next: MihomoRule) => draft.replaceRule(index, formatRule(next))

  const known = isSubRule
    ? subRuleNames(md)
    : [
        ...groupsOf(md).map((g) => g.name),
        ...providersOf(md).map((p) => p.name),
        ...BUILTIN_TARGETS,
      ]

  const targetSelect = (
    <SelectField
      label="Цель"
      hint={
        isSubRule
          ? 'Имя подсписка в sub-rules: правило продолжает разбор в нём.'
          : 'Имя группы, провайдера или встроенная цель.'
      }
      value={rule.target}
      options={optionsOf(known, rule.target)}
      onChange={(target) => commit({ ...rule, target })}
    />
  )

  return (
    <>
      <SelectField
        label="Тип"
        hint="Что правило сравнивает с соединением."
        value={rule.type}
        options={optionsOf(RULE_TYPES, rule.type)}
        // Смена типа собирает строку заново. Пустое значение при переходе с
        // MATCH обязательно: без него строка вышла бы из двух полей
        // («DOMAIN,A»), разбор вернул бы null, и правка молча не применилась бы.
        onChange={(type) =>
          commit({
            ...rule,
            type,
            payload: NO_PAYLOAD.has(type) ? undefined : (rule.payload ?? ''),
          })
        }
      />

      {!NO_PAYLOAD.has(rule.type) && (
        <TextRow
          controlId={payloadId}
          label="Значение"
          hint="С чем сравнивается соединение: домен, подсеть, порт, имя набора правил."
          value={rule.payload ?? ''}
          onCommit={(payload) => commit({ ...rule, payload })}
        />
      )}

      {isSubRule ? (
        targetSelect
      ) : (
        <>
          {customTarget ? (
            <TextRow
              controlId={targetId}
              label="Цель"
              hint="Имя группы, провайдера, встроенная цель или имя хоста, если его подставит панель."
              value={rule.target}
              onCommit={(target) => commit({ ...rule, target })}
            />
          ) : (
            targetSelect
          )}
          <div className="field">
            <Checkbox label="своё имя" checked={customTarget} onChange={setCustomTarget} />
            <span className="field-hint">
              Снимите галочку, чтобы выбрать цель из объявленных в документе.
            </span>
          </div>
        </>
      )}

      <div className="field">
        <span className="field-label">Модификаторы</span>
        {RULE_MODIFIERS.map((mod) => (
          <Checkbox
            key={mod}
            label={mod}
            checked={rule.modifiers.includes(mod)}
            onChange={(on) => {
              const others = rule.modifiers.filter((m) => m !== mod)
              commit({ ...rule, modifiers: on ? [...others, mod] : others })
            }}
          />
        ))}
      </div>
    </>
  )
}

export function MihomoRuleForm({
  md,
  index,
  draft,
}: {
  md: MihomoDoc
  index: number
  draft: MihomoDraft
}) {
  const entry = rulesOf(md).find((r) => r.index === index)
  if (entry === undefined) {
    return <p className="muted">Правила с таким номером в документе нет.</p>
  }
  if (entry.rule === null) {
    // Форма не имеет права записать то, чего сама не разбирает: собранная из
    // полей строка затёрла бы непонятую и потеряла бы её содержимое.
    return (
      <p className="muted">
        Строку правила разобрать не удалось — правьте её на вкладке YAML: «{entry.raw}».
      </p>
    )
  }
  // key: строка правила меняется целиком, и локальные состояния полей обязаны
  // сбрасываться вместе с ней, а не переезжать с прежнего правила
  return <RuleFields key={index} md={md} index={index} rule={entry.rule} draft={draft} />
}

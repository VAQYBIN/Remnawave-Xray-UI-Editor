// Форма правила Mihomo. У правила поля не «ключ → скаляр», а разбор одной
// строки, поэтому форма здесь своя, а не общая с секциями: строка собирается
// заново целиком и уходит одной правкой через draft.replaceRule.

import { useId, useState } from 'react'
import {
  BUILTIN_TARGETS,
  NO_PAYLOAD,
  RULE_MODIFIERS,
  RULE_TYPES,
  formatRule,
  groupsOf,
  parseRule,
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
 * Собирается ли правило обратно из своих полей. Строка правила разделяет поля
 * запятыми ВЕРХНЕГО уровня и не даёт способа выразить такую запятую внутри
 * поля: `DOMAIN` со значением «a,b» перечитается как значение «a» и цель «b» —
 * поля молча съедут, а правка при этом уже уйдёт в документ (форма пишет на
 * каждое нажатие). Поэтому проверяем не одну запятую, а обратимость целиком:
 * тот же приём ловит и лишнюю скобку (она сдвигает уровень вложенности, и
 * запятая за ней снова становится разделителем), а законные запятые ВНУТРИ
 * скобок (`SUB-RULE,(NETWORK,udp),block`) пропускает.
 */
function roundTrips(rule: MihomoRule): boolean {
  const back = parseRule(formatRule(rule))
  return (
    back !== null &&
    back.type === rule.type &&
    (back.payload ?? '') === (rule.payload ?? '') &&
    back.target === rule.target &&
    back.modifiers.join('\u0000') === rule.modifiers.join('\u0000')
  )
}

const REJECTED =
  'Правило с таким значением не собирается обратно: запятая разделяет его поля, и внутри поля её не выразить. Правка не записана.'

/** Поле формы, чей ввод привёл к отказу: объяснение обязано стоять рядом с ним */
type RuleField = 'type' | 'payload' | 'target' | 'modifiers'

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
  error,
  onCommit,
}: {
  controlId: string
  label: string
  value: string
  hint?: string
  /** Почему набранное не записано; поле остаётся с ним, чтобы было что править */
  error?: string | null
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
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          onCommit(e.target.value)
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
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
  // Что именно набрали такого, чего строка правила не выражает. Держим вместе с
  // полем: объяснение обязано стоять там, где его читают, а не одно на форму.
  const [rejected, setRejected] = useState<RuleField | null>(null)

  const isSubRule = rule.type === 'SUB-RULE'
  // Отказ вместо порчи: невыразимое строкой значение НЕ пишется, а объясняется.
  // `field` обязателен и умолчания не имеет: сорваться на необратимости может
  // ЛЮБАЯ правка (например, смена типа у правила, чей payload с запятой попал в
  // документ помимо формы), и путь без названного поля отказывал бы молча.
  const commit = (next: MihomoRule, field: RuleField) => {
    if (!roundTrips(next)) {
      setRejected(field)
      return
    }
    setRejected(null)
    draft.replaceRule(index, formatRule(next))
  }

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
      onChange={(target) => commit({ ...rule, target }, 'target')}
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
          commit(
            {
              ...rule,
              type,
              payload: NO_PAYLOAD.has(type) ? undefined : (rule.payload ?? ''),
            },
            'type',
          )
        }
      />
      {rejected === 'type' ? <span className="field-error">{REJECTED}</span> : null}

      {!NO_PAYLOAD.has(rule.type) && (
        <TextRow
          controlId={payloadId}
          label="Значение"
          hint="С чем сравнивается соединение: домен, подсеть, порт, имя набора правил."
          value={rule.payload ?? ''}
          error={rejected === 'payload' ? REJECTED : null}
          onCommit={(payload) => commit({ ...rule, payload }, 'payload')}
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
              error={rejected === 'target' ? REJECTED : null}
              onCommit={(target) => commit({ ...rule, target }, 'target')}
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
        {rejected === 'modifiers' ? <span className="field-error">{REJECTED}</span> : null}
        {RULE_MODIFIERS.map((mod) => (
          <Checkbox
            key={mod}
            label={mod}
            checked={rule.modifiers.includes(mod)}
            onChange={(on) => {
              const others = rule.modifiers.filter((m) => m !== mod)
              commit({ ...rule, modifiers: on ? [...others, mod] : others }, 'modifiers')
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
  // key — НОМЕР правила, и сбрасывает он локальные состояния (`rejected`,
  // `customTarget`) ровно при переходе на другое правило, а не на любую правку
  // строки. Это меньше, чем хотелось бы: если номера сдвинулись под выбранным
  // узлом (правка на вкладке YAML, undo, восстановление версии), под тем же
  // номером окажется другое правило, а чужой `rejected` останется на экране.
  // Ключом по СОДЕРЖИМОМУ правила это не лечится: форма пишет на каждое нажатие
  // клавиши, строка меняется вместе с ним, и поле пересоздавалось бы под
  // кареткой — тот же довод, что у ListRow в MihomoFieldsForm. Обещать в
  // комментарии сброс «вместе со строкой» было враньём (находка ревью).
  return <RuleFields key={index} md={md} index={index} rule={entry.rule} draft={draft} />
}

// Форма секции шаблона Mihomo. Поля приходят из словаря (entities/mihomo/docSchema),
// значения и происхождение — из документа. Одна компонента обслуживает группу,
// провайдера, набор правил, dns, tun, sniffer, profile и корень: у всех этих
// секций поле — плоская пара «ключ → скаляр», и вторая такая же форма
// разъехалась бы с первой на первом же добавленном ключе.

import { useId, useState } from 'react'
import {
  readFieldAt,
  setFieldAt,
  setListAt,
  type FieldOrigin,
  type MihomoDoc,
  type MihomoField,
} from '../../entities/mihomo'
import type { PathParts } from '../../entities/xray'
import { CollapsibleSection, TextInput, type SelectOption } from '../../shared/ui'
import type { MihomoDraft } from '../editor/useMihomoDraft'
import { CheckboxField, Field, SelectField, StringListField } from './fields'

type FieldValue = string | number | boolean | string[] | undefined

/**
 * Почему поле показано только для чтения. Причин ровно четыре, и все четыре
 * читаются из документа, а не выдумываются формой: три первых — из
 * происхождения и типа поля, последняя — из отказа самого писателя.
 */
type Lock = 'merged' | 'alias' | 'map' | 'nowhere'

const LOCK_NOTE: Record<Lock, string> = {
  // Требование спеки: значение из якоря правится только в тексте, у объявления.
  // Молча развернуть якорь — та самая порча чужого файла, ради предотвращения
  // которой выбрана вся архитектура; молча скрыть поле — соврать, что его нет.
  // Формулировки у слияния и у ссылки разные намеренно: это разные объявления,
  // и пользователю надо знать, какое из них искать в тексте.
  merged: 'Значение приходит через слияние «<<:» — правится в тексте, у объявления слитого отображения.',
  alias: 'Значение приходит через ссылку на якорь «*» — правится в тексте, у объявления якоря.',
  map: 'Значение — вложенное отображение; правится на вкладке YAML.',
  // Обобщённая вставка ищет в тексте место для новой строки и в некоторых
  // документах его не находит (см. setFieldAt/setListAt). Причину форма не
  // разбирает — писатель её не сообщает, а угадывать её здесь значило бы
  // завести второй, расходящийся с ним разбор документа.
  nowhere: 'Форме некуда вписать это поле в текст — добавьте ключ на вкладке YAML.',
}

/**
 * Умеет ли писатель записать это поле. Спрашиваем сам писатель пробной правкой:
 * правки НЕ применяются, функция чистая, а любой другой способ узнать ответ был
 * бы вторым разбором документа, расходящимся с первым.
 */
function lockOf(md: MihomoDoc, parts: PathParts, field: MihomoField, origin: FieldOrigin): Lock | null {
  if (origin === 'merged') return 'merged'
  if (origin === 'alias') return 'alias'
  if (field.type === 'map') return 'map'
  const probe =
    field.type === 'strings'
      ? setListAt(md, parts, field.key, ['x'])
      : setFieldAt(md, parts, field.key, field.type === 'boolean' ? true : field.type === 'number' ? 1 : 'x')
  return probe.length > 0 ? null : 'nowhere'
}

/**
 * Задано ли поле в документе. `own` и `merged` появляются только у
 * существующего ключа, а вот `alias` (`remnawave: *rw`) приходит на ВСЕ ключи
 * анкерного отображения — и на те, которых в нём нет: `originAt` поднимает флаг
 * по пути до отображения, не спрашивая про сам ключ. Без проверки значения
 * такое поле встало бы в список заполненных пустым — а это ровно та стена
 * пустых полей, от которой разделение и спасает.
 *
 * Значение-отображение (`type: 'map'`) читатель тоже отдаёт как `undefined`,
 * поэтому `own`/`merged` доверяем без него.
 *
 * Это НЕ дефект `originAt` и чинить его там не нужно: `FieldOrigin` отвечает на
 * вопрос «можно ли сюда писать», и для ключа, отсутствующего в цели якоря,
 * `alias` — верный ответ (писатель откажет). Ошибкой было бы принять его за
 * ответ на вопрос «есть ли значение» — на него отвечает эта функция.
 */
function isSet(md: MihomoDoc, parts: PathParts, field: MihomoField): boolean {
  const { value, origin } = readFieldAt(md, parts, field.key)
  if (origin === 'absent') return false
  return origin !== 'alias' || value !== undefined
}

/** Варианты словаря плюс текущее значение, если словарь его не знает: выбор в
 *  форме не имеет права молча заменить значение чужого шаблона первым из списка. */
export function optionsWith(field: MihomoField, value: FieldValue): SelectOption[] {
  const options = (field.enum ?? []).map((e) => ({ value: e.value, label: e.value }))
  const current = typeof value === 'string' ? value : ''
  if (current !== '' && !options.some((o) => o.value === current)) {
    return [{ value: current, label: current }, ...options]
  }
  return options
}

function display(value: FieldValue): string {
  if (value === undefined) return ''
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/**
 * Текстовая строка с локальным состоянием. Набранное держится локально, а не
 * перечитывается из документа на каждый символ: правка может быть отклонена
 * писателем, и тогда поле обязано показывать то, что набрал пользователь, а не
 * то, что осталось в тексте. Значение из документа перебивает локальное, как
 * только документ действительно изменился (undo, восстановление версии).
 */
function TextRow({
  controlId,
  label,
  hint,
  value,
  numeric,
  onCommit,
}: {
  controlId: string
  label: string
  hint: string
  value: string
  numeric?: boolean
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
        inputMode={numeric ? 'numeric' : undefined}
        onChange={(e) => {
          setText(e.target.value)
          onCommit(e.target.value)
        }}
      />
    </Field>
  )
}

function LockedRow({
  controlId,
  field,
  value,
  lock,
}: {
  controlId: string
  field: MihomoField
  value: FieldValue
  lock: Lock
}) {
  return (
    <Field label={field.key} hint={`${field.doc} ${LOCK_NOTE[lock]}`} controlId={controlId}>
      <TextInput
        id={controlId}
        value={display(value)}
        readOnly
        placeholder={lock === 'map' ? 'вложенное отображение' : undefined}
      />
    </Field>
  )
}

function FieldRow({
  md,
  parts,
  field,
  draft,
}: {
  md: MihomoDoc
  parts: PathParts
  field: MihomoField
  draft: MihomoDraft
}) {
  const controlId = useId()
  const { value, origin } = readFieldAt(md, parts, field.key)
  const lock = lockOf(md, parts, field, origin)
  if (lock !== null) {
    return <LockedRow controlId={controlId} field={field} value={value} lock={lock} />
  }

  const set = (next: string | number | boolean) => draft.setField(parts, field.key, next)
  // Пустое значение снимает ключ: `filter: ''` и отсутствующий filter — разные
  // конфиги для ядра, и копить первые из-за очищенного поля нельзя
  const clear = () => draft.removeField(parts, field.key)

  // Имя группы адресует её во всём документе: запись ключом оставила бы ссылки
  // правил и других групп висеть на старом имени. Переименование ведёт их за
  // собой, а пустое имя не пишется вовсе — ни ключом, ни переименованием.
  const groupIndex = parts.length === 2 && parts[0] === 'proxy-groups' ? parts[1] : undefined
  if (field.key === 'name' && typeof groupIndex === 'number') {
    return (
      <TextRow
        controlId={controlId}
        label={field.key}
        hint={field.doc}
        value={typeof value === 'string' ? value : ''}
        onCommit={(next) => {
          if (next.trim() !== '') draft.renameGroupTo(groupIndex, next)
        }}
      />
    )
  }

  if (field.type === 'boolean') {
    return (
      <CheckboxField
        label={field.key}
        hint={field.doc}
        value={value === true}
        onChange={(next) => (next === true ? set(true) : origin === 'own' ? clear() : set(false))}
      />
    )
  }
  if (field.type === 'strings') {
    return (
      <StringListField
        label={field.key}
        hint={field.doc}
        value={Array.isArray(value) ? value : []}
        // Опустевший список пишется пустым, а не снимается: удаление ключа
        // унесло бы вместе со строкой комментарий-маркер подстановки, и панель
        // перестала бы подкладывать в это место хосты.
        onChange={(next) => draft.setListAt(parts, field.key, next ?? [])}
      />
    )
  }
  if (field.enum) {
    return (
      <SelectField
        label={field.key}
        hint={field.doc}
        value={typeof value === 'string' ? value : ''}
        options={optionsWith(field, value)}
        onChange={set}
      />
    )
  }
  if (field.type === 'number') {
    return (
      <TextRow
        controlId={controlId}
        label={field.key}
        hint={field.doc}
        value={typeof value === 'number' ? String(value) : ''}
        numeric
        // Недобранное число («3» на пути к «30») пишется как есть, а мусор не
        // пишется вовсе: превращать «30x» в 30 значило бы подменить набранное
        onCommit={(next) => {
          const t = next.trim()
          if (t === '') return clear()
          if (/^\d+$/.test(t)) set(Number(t))
        }}
      />
    )
  }
  return (
    <TextRow
      controlId={controlId}
      label={field.key}
      hint={field.doc}
      value={typeof value === 'string' ? value : ''}
      onCommit={(next) => (next.trim() === '' ? clear() : set(next))}
    />
  )
}

export function MihomoFieldsForm({
  md,
  parts,
  fields,
  draft,
}: {
  md: MihomoDoc
  parts: PathParts
  fields: MihomoField[]
  draft: MihomoDraft
}) {
  // Заполненные поля сверху, остальные — под раскрывашкой: у группы 25 полей
  // словаря, и показанные разом они прячут то, что в документе реально задано.
  //
  // Делит именно `isSet`, а НЕ `origin !== 'absent'`: `FieldOrigin` отвечает на
  // вопрос «можно ли сюда писать», а не «есть ли значение», и у ключа, которого
  // в цели якоря нет, ответ на первый вопрос всё равно `alias` (писать нельзя).
  // Разделение спрашивает про второе — не «чините» это обратно на `origin`.
  const filled = fields.filter((f) => isSet(md, parts, f))
  const rest = fields.filter((f) => !isSet(md, parts, f))
  return (
    <>
      {filled.map((field) => (
        <FieldRow key={field.key} md={md} parts={parts} field={field} draft={draft} />
      ))}
      {rest.length > 0 && (
        <CollapsibleSection title={`Ещё поля (${rest.length})`}>
          {rest.map((field) => (
            <FieldRow key={field.key} md={md} parts={parts} field={field} draft={draft} />
          ))}
        </CollapsibleSection>
      )}
    </>
  )
}

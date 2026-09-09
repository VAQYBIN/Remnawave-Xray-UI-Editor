// Форма выхода sing-box: одна на сервер, группу и конечную точку. Первых
// разводит поле `type`, третью — проп `isEndpoint`: тип у неё свой, и по
// документу его не отличить — знает это только СПИСОК, в котором лежит запись.
//
// Главные поля нарисованы руками, всё остальное даёт SchemaForm по ветви
// схемы. Правка — операции по абсолютному пути: форма не знает, где лежит
// запись, и не собирает документ; писатель приходит из инспектора.

import {
  ENDPOINT_FIELDS,
  ENDPOINT_TYPE_VALUES,
  GROUP_TYPES,
  OUTBOUND_FIELDS,
  OUTBOUND_TYPE_VALUES,
  SERVER_OUTBOUND_TYPES,
  panelFillsGroup,
  type SingboxOutbound,
} from '../../entities/singbox'
import type { DocWriter, RefKind, SchemaPath } from '../../shared/schema'
import { Button, TextInput } from '../../shared/ui'
import { Field, NumberField, SelectField, StringListField, TextField } from './fields'
import { SchemaForm } from './schema/SchemaForm'
import { typeHint, typeOptions } from './schema/typeSelect'

// skip — ровно то, что нарисовано руками: второй раз показывать ключ незачем.
// Списки названы поимённо, а не собраны из JSX: собранный расходился бы с
// разметкой молча, стоило убрать одно поле
const SHOWN_GROUP = ['tag', 'type', 'outbounds', 'remnawave']
const SHOWN_SERVER = ['tag', 'type', 'server', 'server_port']
const SHOWN_ENDPOINT = ['tag', 'type']

const PANEL_NOTE =
  'Панель перезапишет его целиком: у urltest — тегами серверов, у selector — серверами и группами urltest. Чтобы список остался вашим, поставьте remnawave.includeProxies = false.'

export function SingboxOutboundForm({
  value,
  path,
  writer,
  refs,
  isEndpoint = false,
}: {
  value: SingboxOutbound
  /** Абсолютный путь записи: ['outbounds', i] либо ['endpoints', i] */
  path: SchemaPath
  writer: DocWriter
  refs: Partial<Record<RefKind, string[]>>
  /** Запись лежит в endpoints: типы и поля у неё свои */
  isEndpoint?: boolean
}) {
  const isGroup = !isEndpoint && GROUP_TYPES.includes(value.type)
  const isServer = !isEndpoint && SERVER_OUTBOUND_TYPES.includes(value.type)
  const panelFills = !isEndpoint && panelFillsGroup(value)
  const typeValues = isEndpoint ? ENDPOINT_TYPE_VALUES : OUTBOUND_TYPE_VALUES
  const fields = isEndpoint ? ENDPOINT_FIELDS : OUTBOUND_FIELDS
  const at = (key: string): SchemaPath => [...path, key]
  const set = (key: string, next: unknown) => writer.apply([{ op: 'set', path: at(key), value: next }])
  const remove = (key: string) => writer.apply([{ op: 'remove', path: at(key) }])

  return (
    <>
      <TextField
        label="Тег"
        hint="Имя выхода: по нему на него ссылаются правила и группы."
        value={value.tag}
        // Пустой тег — set пустой строки, а не remove: инспектор на него откажет
        // с объяснением, а снятый ключ он бы просто не заметил
        onChange={(v) => set('tag', v ?? '')}
      />
      <SelectField
        label="Тип"
        hint={typeHint(typeValues, value.type)}
        value={value.type}
        options={typeOptions(typeValues, value.type)}
        onChange={(v) => set('type', v)}
      />
      {isServer && (
        <>
          <TextField
            label="Сервер"
            hint="Адрес сервера."
            value={typeof value.server === 'string' ? value.server : undefined}
            onChange={(v) => (v === undefined ? remove('server') : set('server', v))}
          />
          <NumberField
            label="Порт сервера"
            value={typeof value.server_port === 'number' ? value.server_port : undefined}
            onChange={(v) => (v === undefined ? remove('server_port') : set('server_port', v))}
          />
        </>
      )}
      {isGroup &&
        (panelFills ? (
          <>
            <Field label="Участники (список заполняет панель)" hint={PANEL_NOTE}>
              <TextInput readOnly value={(Array.isArray(value.outbounds) ? value.outbounds : []).join('\n')} />
            </Field>
            <Button onClick={() => set('remnawave', { includeProxies: false })}>Закрепить список</Button>
          </>
        ) : (
          <>
            <StringListField
              label="Участники"
              hint="Теги выходов группы по одному в строке. Список закреплён: панель его не тронет."
              value={Array.isArray(value.outbounds) && value.outbounds.length > 0 ? value.outbounds : undefined}
              onChange={(v) => set('outbounds', v ?? [])}
            />
            {/* includeProxies: true — не «как было»: осмысленное значение у ключа ровно одно */}
            <Button variant="ghost" onClick={() => remove('remnawave')}>
              Открепить список
            </Button>
          </>
        ))}
      <SchemaForm
        fields={fields}
        value={value as Record<string, unknown>}
        path={path}
        writer={writer}
        refs={refs}
        skip={isEndpoint ? SHOWN_ENDPOINT : isGroup ? SHOWN_GROUP : SHOWN_SERVER}
      />
    </>
  )
}

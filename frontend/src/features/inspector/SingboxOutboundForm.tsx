// Форма выхода sing-box: одна на сервер, на группу и на конечную точку. Первых
// двух разводит поле `type`, третью — проп `isEndpoint`: тип у неё свой, и по
// документу его не отличить — знает это только СПИСОК, в котором лежит запись.
//
// Правка идёт по модели: копия, мутация копии, `onChange(next)` — как у
// `RuleForm` в редакторе Xray.

import {
  fieldFor,
  GROUP_OUTBOUND_TYPES,
  panelFillsGroup,
  REMOVED_OUTBOUND_TYPES,
  type SingboxOutbound,
} from '../../entities/singbox'
import { nestedFields } from '../../entities/singbox/docPath'
import { Button, TextInput, type SelectOption } from '../../shared/ui'
import { Field, NumberField, SelectField, StringListField, TextField } from './fields'
import { SingboxExtraFields } from './SingboxExtraFields'

// skip — ровно то, что уже нарисовано выше: второй раз показывать ключ незачем.
// Список назван поимённо, а не собран из JSX: собранный расходился бы с
// разметкой молча, стоило убрать одно поле
const SHOWN_GROUP = ['tag', 'type', 'outbounds', 'remnawave']
const SHOWN_SERVER = ['tag', 'type', 'server', 'server_port']

/** Ключ панели описан в словаре — второй текст про него разошёлся бы с первым */
const PANEL_KEY_DOC = nestedFields('group', 'remnawave').find((f) => f.key === 'includeProxies')?.doc

/**
 * Типы записей списка `endpoints`. Секции в словаре у них пока нет — она придёт
 * вместе с полной формой конечной точки; здесь важно другое: типы outbound'а
 * (`vless`, `direct`, …) в этот список ядру не годятся вовсе, и предложить их
 * значит дать собрать документ, который ядро не примет.
 */
const ENDPOINT_TYPES = ['wireguard', 'tailscale']

/**
 * Типы, удалённые из ядра в 1.13. В словаре их больше нет (см. `docSchema.ts`),
 * но в уже написанных шаблонах они стоят: текст объясняет, чем заменить, — иначе
 * пользователь видел бы выбранным значение, которого ни в одном списке нет.
 * Чем именно заменить, знает `validate.ts` — тот же факт он пишет в диагностику.
 */
function removedTypeHint(type: string): string | undefined {
  const replacement = REMOVED_OUTBOUND_TYPES[type]
  return replacement === undefined
    ? undefined
    : `Тип ${type} удалён в sing-box 1.13. Замена — правило с ${replacement}.`
}

/** Варианты словаря плюс текущий тип, если словарь его не знает: выбор в форме
 *  не имеет права молча заменить тип чужого шаблона первым из списка */
function typeOptions(current: string, isEndpoint: boolean): SelectOption[] {
  const options = isEndpoint
    ? ENDPOINT_TYPES.map((value) => ({ value, label: value }))
    : (fieldFor('outbound', 'type')?.enum ?? []).map((e) => ({ value: e.value, label: e.value }))
  if (current !== '' && !options.some((o) => o.value === current)) {
    return [{ value: current, label: current }, ...options]
  }
  return options
}

export function SingboxOutboundForm({
  value,
  knownTags,
  isEndpoint = false,
  onChange,
}: {
  value: SingboxOutbound
  /** Теги выходов документа — подсказка для списка участников группы */
  knownTags: string[]
  /** Запись лежит в `endpoints`, а не в `outbounds`: типы и поля у неё свои */
  isEndpoint?: boolean
  onChange: (next: SingboxOutbound) => void
}) {
  // Конечная точка группой не бывает: `selector` и `urltest` живут только в
  // `outbounds`. Проверка списка идёт первой, иначе запись с чужим типом
  // показала бы форму группы вместо справки о том, где её править
  const isGroup = !isEndpoint && GROUP_OUTBOUND_TYPES.has(value.type)
  const panelFills = panelFillsGroup(value)

  function patch(mut: (draft: SingboxOutbound) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <TextField
        label="Тег"
        hint="Имя выхода: по нему на него ссылаются правила и группы."
        value={value.tag}
        onChange={(v) => patch((n) => { if (v === undefined) delete n.tag; else n.tag = v })}
      />
      <SelectField
        label="Тип"
        hint={removedTypeHint(value.type)}
        value={value.type}
        options={typeOptions(value.type, isEndpoint)}
        onChange={(v) => patch((n) => { n.type = v })}
      />
      {isEndpoint ? (
        // Полей конечной точки форма пока не знает: ключи, адреса и пиры лежат
        // в своей схеме, а показать вместо них «Сервер» и «Порт сервера» значило
        // бы предложить править то, чего у записи нет
        <p className="muted">
          Это конечная точка (endpoints): её поля — ключи, адреса и пиры — пока правятся на вкладке
          JSON узла.
        </p>
      ) : isGroup ? (
        <>
          {panelFills ? (
            // Список выходов группы — только на чтение, пока его заполняет
            // панель. Показать его редактируемым значило бы предложить правку,
            // которая исчезнет при первой же выдаче подписки: панель
            // перезаписывает список ЦЕЛИКОМ.
            <Field
              label="Участники (список заполняет панель)"
              hint="Панель перезапишет его целиком тегами серверов подписки — что бы здесь ни стояло."
            >
              <TextInput readOnly value={(value.outbounds ?? []).join(', ')} />
            </Field>
          ) : (
            <StringListField
              label="Участники"
              hint={knownTags.length > 0 ? `Выходы документа: ${knownTags.join(', ')}` : undefined}
              value={value.outbounds ?? undefined}
              // Опустевший список пишется пустым, а не снимается ключом:
              // «не заполняли» и «заполнили пустым» — разные состояния группы
              onChange={(v) => patch((n) => { n.outbounds = v ?? [] })}
            />
          )}
          <div className="field">
            <Button
              variant="ghost"
              onClick={() =>
                patch((n) => {
                  if (panelFills) {
                    n.remnawave = { includeProxies: false }
                    n.outbounds = value.outbounds ?? []
                  } else {
                    // Снимаем ключ целиком, а не ставим true: осмысленное
                    // значение у него ровно одно, и `true` осталось бы следом
                    // правки в отданном клиенту конфиге
                    delete n.remnawave
                  }
                })
              }
            >
              {panelFills ? 'Закрепить список' : 'Открепить список'}
            </Button>
            {PANEL_KEY_DOC ? <span className="field-hint">{PANEL_KEY_DOC}</span> : null}
          </div>
        </>
      ) : (
        <>
          <TextField
            label="Сервер"
            value={typeof value.server === 'string' ? value.server : undefined}
            onChange={(v) => patch((n) => { if (v === undefined) delete n.server; else n.server = v })}
          />
          <NumberField
            label="Порт сервера"
            value={typeof value.server_port === 'number' ? value.server_port : undefined}
            onChange={(v) => patch((n) => { if (v === undefined) delete n.server_port; else n.server_port = v })}
          />
        </>
      )}
      {/* Ключи протокола (password, method, uuid, flow…) основная часть не
          перечисляет: их набор зависит от протокола, и захардкоженный список
          разошёлся бы со словарём на первом же добавленном ключе */}
      <SingboxExtraFields
        section={isGroup ? 'group' : 'outbound'}
        value={value}
        skip={isGroup ? SHOWN_GROUP : SHOWN_SERVER}
        onChange={(next) => onChange(next as SingboxOutbound)}
      />
    </>
  )
}

// Форма выхода sing-box: одна на сервер и на группу — их разводит поле `type`.
//
// Правка идёт по модели: копия, мутация копии, `onChange(next)` — как у
// `RuleForm` в редакторе Xray.

import { fieldFor, GROUP_OUTBOUND_TYPES, panelFillsGroup, type SingboxOutbound } from '../../entities/singbox'
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

/** Варианты словаря плюс текущий тип, если словарь его не знает: выбор в форме
 *  не имеет права молча заменить тип чужого шаблона первым из списка */
function typeOptions(current: string): SelectOption[] {
  const options = (fieldFor('outbound', 'type')?.enum ?? []).map((e) => ({ value: e.value, label: e.value }))
  if (current !== '' && !options.some((o) => o.value === current)) {
    return [{ value: current, label: current }, ...options]
  }
  return options
}

export function SingboxOutboundForm({
  value,
  knownTags,
  onChange,
}: {
  value: SingboxOutbound
  /** Теги выходов документа — подсказка для списка участников группы */
  knownTags: string[]
  onChange: (next: SingboxOutbound) => void
}) {
  const isGroup = GROUP_OUTBOUND_TYPES.has(value.type)
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
        value={value.type}
        options={typeOptions(value.type)}
        onChange={(v) => patch((n) => { n.type = v })}
      />
      {isGroup ? (
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

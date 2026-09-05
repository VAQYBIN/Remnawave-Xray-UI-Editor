// Группа подстановки: панель выберет по селектору хосты, построит из них
// outbound'ы и вставит в начало массива. Способ именования тегов ровно один из
// трёх — форма делает состояние «два сразу» невыразимым.

import { useRef } from 'react'
import {
  predictedTags,
  tagScheme,
  withTagScheme,
  SELECTOR_TYPES,
  SELECT_FROM,
  TAG_SCHEME_KEYS,
  type InjectGroup,
  type TagSchemeKey,
} from '../../entities/xray'
import { SelectField, StringListField, TextField, type Option } from './fields'

type Obj = Record<string, unknown>

// Карта, а не отдельный литеральный массив: новый тип/пул в entities/xray/inject.ts
// сломает сборку здесь, пока для него не написана подпись — та же защита от
// рассинхронизации, что у TAG_SCHEME_KEYS.
const SELECTOR_LABELS: Record<(typeof SELECTOR_TYPES)[number], string> = {
  sameTagAsRecipient: 'sameTagAsRecipient — хост с тем же тегом, что у получателя',
  tagRegex: 'tagRegex — по регулярке на тег хоста',
  remarkRegex: 'remarkRegex — по регулярке на примечание',
  uuids: 'uuids — по списку хостов',
}

// Порядок берём из канонического перечня: два источника порядка разъехались бы
// так же незаметно, как два источника значений
const SELECTOR_OPTIONS: Option[] = SELECTOR_TYPES.map((value) => ({
  value,
  label: SELECTOR_LABELS[value],
}))

const POOL_LABELS: Record<(typeof SELECT_FROM)[number], string> = {
  HIDDEN: 'HIDDEN — скрытые хосты (по умолчанию)',
  NOT_HIDDEN: 'NOT_HIDDEN — видимые хосты',
  ALL: 'ALL — все хосты',
}

const POOL_OPTIONS: Option[] = SELECT_FROM.map((value) => ({
  value,
  label: POOL_LABELS[value],
}))

const SCHEME_LABELS: Record<TagSchemeKey, string> = {
  // Пример короче, чем в predictedTags (proxy, proxy-2, proxy-3): иначе текст
  // выбранной опции совпал бы с подсказкой предсказанных тегов по regexp в тестах
  tagPrefix: 'префикс — proxy, proxy-2…',
  useHostRemarkAsTag: 'примечание хоста',
  useHostTagAsTag: 'тег хоста',
}

const SCHEME_OPTIONS: Option[] = TAG_SCHEME_KEYS.map((value) => ({
  value,
  label: SCHEME_LABELS[value],
}))

function currentSchemeKey(group: InjectGroup): TagSchemeKey | '' {
  if (group.useHostRemarkAsTag === true) return 'useHostRemarkAsTag'
  if (group.useHostTagAsTag === true) return 'useHostTagAsTag'
  if (typeof group.tagPrefix === 'string') return 'tagPrefix'
  return ''
}

export function InjectGroupForm({
  value,
  onChange,
}: {
  value: Obj
  onChange: (next: Obj) => void
}) {
  const group = value as InjectGroup
  const selectorType = (group.selector?.type as string | undefined) ?? ''
  const scheme = tagScheme(group)
  const schemeKey = currentSchemeKey(group)
  const tags = predictedTags(group)

  // Переключение схемы стирает tagPrefix из документа — и правильно, лишний ключ
  // делает состояние невалидным. Но введённое пользователем значение помним мы:
  // вернуться к префиксу и обнаружить чужой proxy вместо своего — потеря данных
  const lastPrefix = useRef(group.tagPrefix || 'proxy')
  if (typeof group.tagPrefix === 'string' && group.tagPrefix !== '') {
    lastPrefix.current = group.tagPrefix
  }

  function patch(mut: (draft: Obj) => void) {
    const next = structuredClone(value)
    mut(next)
    onChange(next)
  }

  return (
    <>
      <SelectField
        label="Тип селектора"
        hint="Как панель отберёт хосты для этой группы"
        value={selectorType}
        options={SELECTOR_OPTIONS}
        onChange={(type) =>
          patch((draft) => {
            const selector = (draft.selector as Obj | undefined) ?? {}
            // Параметр принадлежит типу: смена типа делает чужой параметр мусором
            delete selector.pattern
            delete selector.values
            selector.type = type
            draft.selector = selector
          })
        }
      />

      {(selectorType === 'tagRegex' || selectorType === 'remarkRegex') && (
        <TextField
          label="Регулярное выражение"
          mono
          hint={
            selectorType === 'tagRegex'
              ? 'Проверяется против тега хоста в панели, например ^RU-'
              : 'Проверяется против примечания хоста'
          }
          value={group.selector?.pattern}
          onChange={(pattern) =>
            patch((draft) => {
              const selector = (draft.selector as Obj | undefined) ?? {}
              if (pattern === undefined || pattern === '') delete selector.pattern
              else selector.pattern = pattern
              draft.selector = selector
            })
          }
        />
      )}

      {selectorType === 'uuids' && (
        <StringListField
          label="UUID хостов"
          hint="Список uuid из панели; пустой список не подставит ни одного сервера"
          value={group.selector?.values}
          onChange={(values) =>
            patch((draft) => {
              const selector = (draft.selector as Obj | undefined) ?? {}
              if (values === undefined || values.length === 0) delete selector.values
              else selector.values = values
              draft.selector = selector
            })
          }
        />
      )}

      <SelectField
        label="Пул выбора хостов"
        hint="Из каких хостов панели выбирать. Не задано — панель возьмёт HIDDEN"
        value={(group.selectFrom as string | undefined) ?? 'HIDDEN'}
        options={POOL_OPTIONS}
        onChange={(selectFrom) => patch((draft) => { draft.selectFrom = selectFrom })}
      />

      <SelectField
        label="Способ именования тегов"
        hint="Ровно один из трёх: выбор снимает остальные"
        value={schemeKey}
        options={SCHEME_OPTIONS}
        onChange={(key) => onChange(withTagScheme(group, key as TagSchemeKey, lastPrefix.current) as Obj)}
      />

      {schemeKey === 'tagPrefix' && (
        <TextField
          label="Префикс тегов"
          mono
          hint="Первый выход получит сам префикс, следующие — префикс с номером"
          value={group.tagPrefix}
          onChange={(tagPrefix) =>
            patch((draft) => {
              if (tagPrefix === undefined || tagPrefix === '') delete draft.tagPrefix
              else draft.tagPrefix = tagPrefix
            })
          }
        />
      )}

      {scheme === 'prefix' && (
        <p className="field-hint">
          Правила и балансеры смогут ссылаться на {tags.join(', ')} — редактор проверяет такие
          ссылки. Сколько серверов подставится на самом деле, знает панель.
        </p>
      )}
      {scheme === 'panel' && (
        <p className="field-warning">
          Теги выходов знает только панель — редактор не может проверить ссылки на них, и проверки
          «неизвестный outbound» и «у балансера нет кандидатов» отключаются для всего документа.
        </p>
      )}
      {scheme === 'none' && (
        <p className="field-error">
          Способ именования не выбран — панель не сможет назвать подставленные выходы.
        </p>
      )}
    </>
  )
}

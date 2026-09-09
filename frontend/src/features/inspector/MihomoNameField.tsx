// Поле имени записи: имя адресует узел во всём документе, и пишется оно не
// операцией set, а переименованием с переносом ссылок. Набранное держится
// локально: переименование может быть отклонено (имя занято), и поле обязано
// показывать набранное вместе с причиной, а не откатывать его к документу.
// Документ перебивает буфер, когда имя изменилось не отсюда (undo, версия).
//
// Коммит — на blur и на Enter, не на каждой клавише (находка ревью I1):
// переименование — это `applyMihomoOps` пачкой по всем ссылкам, то есть
// перепечатка всего документа и снимок истории на каждую букву — 0.4–0.9 с на
// среднем шаблоне и слот истории на каждый символ. При отказе на
// промежуточном имени документ к тому же застревал на последнем ПРИНЯТОМ
// префиксе, а не на том, что видел пользователь. `Escape` отменяет набранное
// и возвращает буфер к текущему имени документа, не коммитя его.
import { useId, useState } from 'react'
import { TextInput } from '../../shared/ui'
import { Field } from './fields'

export function MihomoNameField({ value, hint, onRename }: { value: string; hint: string; onRename: (to: string) => string | null }) {
  const id = useId()
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  const [error, setError] = useState<string | null>(null)
  if (seen !== value) {
    setSeen(value)
    setText(value)
    setError(null)
  }
  const commit = () => {
    if (text === value) {
      setError(null)
      return
    }
    setError(onRename(text))
  }
  return (
    <Field label="Имя" hint={hint} controlId={id}>
      <TextInput
        id={id}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setText(value)
            setError(null)
          }
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </Field>
  )
}

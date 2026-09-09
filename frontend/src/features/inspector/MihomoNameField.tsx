// Поле имени записи: имя адресует узел во всём документе, и пишется оно не
// операцией set, а переименованием с переносом ссылок. Набранное держится
// локально: переименование может быть отклонено (имя занято), и поле обязано
// показывать набранное вместе с причиной, а не откатывать его к документу.
// Документ перебивает буфер, когда имя изменилось не отсюда (undo, версия).

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
  return (
    <Field label="Имя" hint={hint} controlId={id}>
      <TextInput
        id={id}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setError(onRename(e.target.value))
        }}
      />
      {error ? <span className="field-error">{error}</span> : null}
    </Field>
  )
}

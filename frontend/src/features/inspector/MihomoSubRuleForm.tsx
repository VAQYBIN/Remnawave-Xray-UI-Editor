// Форма подсписка правил (`sub-rules.<имя>`): имя записи и карточки правил,
// каждая — тот же `MihomoRuleForm`, что и у основного списка `rules`, по пути
// внутрь подсписка. Разметка карточек — как у `ListSection` в `DocPanel`:
// подсписок здесь не отдельная семья форм, а список, живущий не под `rules`.

import type { DocWriter, SchemaPath } from '../../shared/schema'
import { Button } from '../../shared/ui'
import type { DocRefs } from './schema/DocPanel'
import { MihomoNameField } from './MihomoNameField'
import { MihomoRuleForm } from './MihomoRuleForm'

export function MihomoSubRuleForm({
  rules,
  path,
  writer,
  refs,
  name,
  onRename,
}: {
  rules: string[]
  path: SchemaPath
  writer: DocWriter
  refs: DocRefs
  name: string
  onRename: (to: string) => string | null
}) {
  return (
    <>
      <MihomoNameField
        value={name}
        hint="На подсписок ссылается правило SUB-RULE и вход (listeners[].rule)."
        onRename={onRename}
      />
      <div className="list-editor">
        {rules.length === 0 && <p className="muted">Правил пока нет — кнопка ниже заведёт первое.</p>}
        {rules.map((raw, i) => (
          <div key={i} className="list-editor-card">
            <div className="list-editor-body">
              <span className="eyebrow">#{i + 1}</span>
              <MihomoRuleForm raw={raw} path={[...path, i]} writer={writer} refs={refs} />
            </div>
            <div className="list-editor-order">
              <button
                type="button"
                className="chip-order"
                aria-label={`Переместить элемент ${i + 1} выше`}
                disabled={i === 0}
                onClick={() => writer.apply([{ op: 'move', path, from: i, to: i - 1 }])}
              >
                ↑
              </button>
              <button
                type="button"
                className="chip-order"
                aria-label={`Переместить элемент ${i + 1} ниже`}
                disabled={i === rules.length - 1}
                onClick={() => writer.apply([{ op: 'move', path, from: i, to: i + 1 }])}
              >
                ↓
              </button>
            </div>
            <button
              type="button"
              className="chip-x"
              aria-label={`Удалить элемент ${i + 1}`}
              onClick={() => writer.apply([{ op: 'remove', path: [...path, i] }])}
            >
              ✕
            </button>
          </div>
        ))}
        <Button
          onClick={() =>
            writer.apply([
              { op: 'insert', path, index: rules.length, value: 'DOMAIN-SUFFIX,example.com,DIRECT' },
            ])
          }
        >
          + Правило
        </Button>
      </div>
      <p className="muted">
        Подсписок без MATCH нормален: если ни одно правило не совпало, проход возвращается в основной
        список.
      </p>
    </>
  )
}

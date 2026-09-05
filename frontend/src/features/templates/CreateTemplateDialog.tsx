import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateTemplate } from '../../shared/api'
import { Button, Dialog, TextInput } from '../../shared/ui'
import { NAME_RE } from '../../shared/lib/nameRules'

export function CreateTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const create = useCreateTemplate()
  const navigate = useNavigate()
  const valid = NAME_RE.test(name)
  const invalid = name !== '' && !valid

  return (
    <Dialog open={open} title="Создать шаблон подписки" onClose={onClose}>
      {/* Разметка поля — как в CreateProfileDialog: лейбл связан по htmlFor */}
      <div className="field">
        <label className="field-label" htmlFor="template-name">
          Имя шаблона
        </label>
        <TextInput
          id="template-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Xray Default"
        />
        {invalid && (
          <span className="field-error">Имя: 2–30 символов, латиница, цифры, пробел, - и _</span>
        )}
        {create.isError && <span className="field-error">{(create.error as Error).message}</span>}
      </div>
      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button
          variant="primary"
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate(
              { name },
              {
                onSuccess: (template) => {
                  onClose()
                  setName('')
                  // Создали — сразу открываем: пустой шаблон в списке бесполезен
                  navigate(`/templates/${template.uuid}`)
                },
              },
            )
          }
        >
          Создать
        </Button>
      </div>
    </Dialog>
  )
}

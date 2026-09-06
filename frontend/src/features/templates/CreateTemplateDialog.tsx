import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCreateTemplate } from '../../shared/api'
import { Button, Dialog, TextInput } from '../../shared/ui'
import { SelectField, type Option } from '../inspector/fields'
import { NAME_RE } from '../../shared/lib/nameRules'

/**
 * Типы, которые умеет редактор. Остальные четыре панель тоже заводит, но
 * править их здесь нечем — предлагать их в диалоге значило бы создавать
 * шаблон, который тут же отправит пользователя в панель.
 */
const TYPES: Option[] = [
  { value: 'XRAY_JSON', label: 'Xray (JSON)' },
  { value: 'MIHOMO', label: 'Mihomo (YAML)' },
]

export function CreateTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  // Тип менять после создания панель не даёт, поэтому выбор делается здесь.
  // Умолчание — XRAY_JSON: с него редактор начинался, и большинство шаблонов
  // панели именно такие
  const [templateType, setTemplateType] = useState<'XRAY_JSON' | 'MIHOMO'>('XRAY_JSON')
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
      <SelectField
        label="Тип шаблона"
        hint="Тип задаётся при создании: панель менять его не даёт."
        value={templateType}
        options={TYPES}
        onChange={(v) => setTemplateType(v === 'MIHOMO' ? 'MIHOMO' : 'XRAY_JSON')}
      />
      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button
          variant="primary"
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate(
              { name, templateType },
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

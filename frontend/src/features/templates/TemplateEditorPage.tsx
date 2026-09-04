// Редактор шаблона подписки. Отличий от редактора профиля ровно пять: база
// черновика — хэш содержимого (updatedAt у шаблонов нет), сохранение шлёт
// expectedHash, контекст графа пуст (сквадов у шаблона нет), проверки ядром и
// рецептов в топбаре нет — они про конфиг ноды, а не про клиентскую подписку, —
// и только здесь на холсте есть «+ Подстановка»: секция remnawave бывает лишь у
// шаблона (allowInject).

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ConflictError,
  useSaveTemplate,
  useTemplate,
  type SubscriptionTemplate,
} from '../../shared/api'
import type { GraphContext } from '../../entities/graph/types'
import { Button, Dialog } from '../../shared/ui'
import { SaveDialog } from '../editor/SaveDialog'
import { Workbench } from '../editor/Workbench'
import { useConfigDraft } from '../editor/useConfigDraft'

// Контекст графа у шаблона пуст: buildGraph уже фильтрует сквады по реально
// существующим тегам inbound'ов, поэтому колонка сквадов просто не появится.
// Константа, а не литерал в пропсе: иначе новый объект на каждый рендер сбрасывал
// бы мемоизацию графа.
const NO_CONTEXT: GraphContext = {}

/** Состояние конфликта: хэш здесь уже сужен до строки — без него перезаписывать нечем */
interface ConflictState {
  template: SubscriptionTemplate
  hash: string
}

function TemplateEditor({ template, hash }: { template: SubscriptionTemplate; hash: string }) {
  const qc = useQueryClient()
  const draft = useConfigDraft({
    docKey: template.uuid,
    panelConfig: template.templateJson,
    baseVersion: hash,
    ctx: NO_CONTEXT,
  })
  const save = useSaveTemplate(template.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)

  function doSave(expectedHash: string) {
    save.mutate(
      { templateJson: draft.validation.config, expectedHash },
      {
        onSuccess: () => {
          draft.clearAfterSave()
          setSaveOpen(false)
          setConflict(null)
        },
        onError: (err) => {
          if (err instanceof ConflictError) {
            setSaveOpen(false)
            // Роут шаблонов кладёт в `current` шаблон, а рядом — его хэш. Хэш кладёт
            // сам бэкенд; без него версия панели бесполезна — перезаписывать нечем,
            // поэтому просто перечитываем шаблон
            if (typeof err.hash === 'string') {
              setConflict({ template: err.current as SubscriptionTemplate, hash: err.hash })
            } else {
              qc.invalidateQueries({ queryKey: ['templates', template.uuid] })
            }
          }
        },
      },
    )
  }

  const saveError =
    save.isError && !(save.error instanceof ConflictError)
      ? (save.error as Error).message
      : undefined

  return (
    <Workbench
      draft={draft}
      kind="templates"
      back={{ to: '/templates', label: '← Шаблоны' }}
      title={template.name}
      subtitle={`шаблон ${template.templateType}`}
      allowInject
      statusExtra={saveError ? <span className="field-error">{saveError}</span> : undefined}
      save={
        <Button
          variant="primary"
          disabled={draft.hasErrors || !draft.dirty || save.isPending}
          onClick={() => setSaveOpen(true)}
        >
          Сохранить в панель
        </Button>
      }
    >
      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        original={draft.panelText}
        modified={draft.text}
        issues={draft.validation.issues}
        busy={save.isPending}
        onConfirm={() => doSave(draft.baseVersion)}
        error={saveError}
      />

      <Dialog open={conflict !== null} title="Конфликт версий" onClose={() => setConflict(null)}>
        {/* У шаблонов нет updatedAt — сказать «когда» нечем, только «что» */}
        <p>Шаблон был изменён в панели после того, как вы его открыли. Выберите, что делать:</p>
        <div className="row">
          <span className="spacer" />
          <Button
            variant="ghost"
            onClick={() => {
              if (!conflict) return
              draft.adoptPanelVersion()
              qc.setQueryData(['templates', template.uuid], {
                template: conflict.template,
                hash: conflict.hash,
              })
              qc.invalidateQueries({ queryKey: ['templates'], exact: true })
              setConflict(null)
            }}
          >
            Загрузить версию панели
          </Button>
          <Button
            variant="danger"
            disabled={save.isPending || draft.hasErrors}
            onClick={() => {
              if (conflict) doSave(conflict.hash)
            }}
          >
            Перезаписать
          </Button>
        </div>
      </Dialog>
    </Workbench>
  )
}

export function TemplateEditorPage() {
  const { uuid } = useParams<{ uuid: string }>()
  // До ранних возвратов: порядок хуков обязан быть одинаковым во всех ветках
  const navigate = useNavigate()
  const query = useTemplate(uuid!)
  // Возврат в список: на обе тупиковые ветки попадают чаще всего по прямой ссылке
  // или закладке, поэтому ведём по адресу, а не назад по истории браузера
  const back = (
    <Button variant="ghost" onClick={() => navigate('/templates')}>
      ← Шаблоны
    </Button>
  )

  if (query.isPending) {
    return (
      <main style={{ padding: 24 }} className="muted">
        Загрузка шаблона…
      </main>
    )
  }
  if (query.isError) {
    return (
      <main style={{ padding: 24 }}>
        <p className="field-error">{(query.error as Error).message}</p>
        {back}
      </main>
    )
  }
  const { template, hash } = query.data
  // YAML-типы держат содержимое в encodedTemplateYaml, а templateJson у них null:
  // открыть их этим редактором нельзя, и молчать об этом — худшее из решений
  if (template.templateType !== 'XRAY_JSON') {
    return (
      <main style={{ padding: 24 }}>
        <p>
          Редактор пока умеет только шаблоны XRAY_JSON, а «{template.name}» —{' '}
          {template.templateType}. Откройте его в панели Remnawave.
        </p>
        {back}
      </main>
    )
  }
  // key: переход между двумя закэшированными шаблонами не перемонтирует компонент
  // сам по себе, и выбранный узел, вкладка и цель трассировки пережили бы смену
  // документа — позиционные id правил и групп при этом указывают уже не туда
  return <TemplateEditor key={template.uuid} template={template} hash={hash} />
}

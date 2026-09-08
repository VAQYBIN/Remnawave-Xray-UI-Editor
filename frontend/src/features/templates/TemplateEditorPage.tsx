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
  isTemplateOfType,
  useSaveTemplate,
  useTemplate,
  type SubscriptionTemplate,
  type TemplateOfType,
} from '../../shared/api'
import type { GraphContext } from '../../entities/graph/types'
import { Button, Dialog } from '../../shared/ui'
import { ImportTemplateDialog } from './ImportTemplateDialog'
import { MihomoEditorPage } from './MihomoEditorPage'
import { SaveDialog } from '../editor/SaveDialog'
import { Workbench } from '../editor/Workbench'
import { useConfigDraft } from '../editor/useConfigDraft'

// Контекст графа у шаблона пуст: buildGraph уже фильтрует сквады по реально
// существующим тегам inbound'ов, поэтому колонка сквадов просто не появится.
// Константа, а не литерал в пропсе: иначе новый объект на каждый рендер сбрасывал
// бы мемоизацию графа.
const NO_CONTEXT: GraphContext = {}

// Шаблон, заведённый в самой панели и ни разу не заполненный вторым шагом
// создания, приходит с `templateJson: null` (либо, в теории, с массивом или
// примитивом — панель это тоже не запрещает). Открывать такое как документ
// с текстом `null`/`[]` бессмысленно: подставляем пустой объект. Константа,
// а не литерал в пропсе useConfigDraft — по той же причине, что и NO_CONTEXT
// выше: новый литерал на каждый рендер был бы новым по ссылке и сбрасывал
// мемоизацию (formatConfig в useMemo по panelConfig).
const EMPTY_TEMPLATE_CONFIG: Record<string, never> = {}

/**
 * `templateJson` панели — словарь только у заполненного шаблона. `null` (пустой
 * шаблон панели), массив и примитив — не конфиг Xray, открывать их как документ
 * незачем. Не переиспользуем `isObject` из `configFile.ts`: там она локальна для
 * своего файла (разбор бэкапов) и заведена под другую задачу — тащить её наружу
 * ради одной проверки здесь не стоит.
 */
function isDictionary(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Состояние конфликта: хэш здесь уже сужен до строки — без него перезаписывать нечем */
interface ConflictState {
  template: SubscriptionTemplate
  hash: string
}

function TemplateEditor({
  template,
  hash,
}: {
  template: TemplateOfType<'XRAY_JSON'>
  hash: string
}) {
  const qc = useQueryClient()
  const hasContent = isDictionary(template.templateJson)
  const draft = useConfigDraft({
    docKind: 'template',
    docKey: template.uuid,
    panelConfig: hasContent ? template.templateJson : EMPTY_TEMPLATE_CONFIG,
    baseVersion: hash,
    ctx: NO_CONTEXT,
  })
  const save = useSaveTemplate(template.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  // Каталог отдаёт шаблоны всех типов, и Xray-редактору он нужен ровно так же,
  // как Mihomo. Состояние здесь местное: useConfigDraft общий с профилем, а у
  // профиля импортировать из каталога подписок нечего
  const [importOpen, setImportOpen] = useState(false)

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

  // Пропадает сам собой после сохранения: useSaveTemplate кладёт в кэш
  // {template, hash} с уже заполненным templateJson, hasContent пересчитается.
  const emptyNotice = !hasContent ? (
    <span className="field-warning">
      Шаблон в панели пуст — редактор открыл его как пустой документ. Сохранение
      запишет в панель то, что вы здесь соберёте.
    </span>
  ) : undefined

  return (
    <Workbench
      draft={draft}
      kind="templates"
      back={{ to: '/templates', label: '← Шаблоны' }}
      title={template.name}
      subtitle={`шаблон ${template.templateType}`}
      allowInject
      actions={
        <Button variant="ghost" onClick={() => setImportOpen(true)}>
          Импорт
        </Button>
      }
      statusExtra={
        saveError ? (
          <span className="field-error">{saveError}</span>
        ) : (
          emptyNotice
        )
      }
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
      <ImportTemplateDialog
        open={importOpen}
        docType={template.templateType}
        dirty={draft.dirty}
        onImport={(content) => {
          // Импорт — правка черновика, а не запись в панель: пользователь видит
          // шаблон в редакторе, может отменить его через Ctrl+Z и сам решает,
          // сохранять ли. Выбор снимаем: документ заменён целиком, а id узлов
          // считаются по тегам и позициям правил старого
          draft.writeDraft(content, { history: true })
          draft.setSelectedNode(null)
        }}
        onClose={() => setImportOpen(false)}
      />

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
  // Тип известен только после загрузки, поэтому маршрут у обоих редакторов один
  // (/templates/:uuid), а разводит их страница — там, где уже стояла проверка
  // типа. Отдельный адрес пришлось бы угадывать в списке шаблонов.
  // key — по той же причине, что и у TemplateEditor ниже.
  // Обе открываемые ветки — через предикат, а не через сравнение поля: только
  // он доносит тип до самого редактора, и тому не приходится повторять его
  // строкой. По той же причине тупик стоит последним: отрицание предиката
  // («не XRAY_JSON») не сужает ничего, и ранний возврат оставлял бы редактор
  // ниже с тем же неопределённым типом, с какого начали.
  //
  // key: переход между двумя закэшированными шаблонами не перемонтирует компонент
  // сам по себе, и выбранный узел, вкладка и цель трассировки пережили бы смену
  // документа — позиционные id правил и групп при этом указывают уже не туда
  if (isTemplateOfType(template, 'MIHOMO')) {
    return <MihomoEditorPage key={template.uuid} template={template} hash={hash} />
  }
  if (isTemplateOfType(template, 'XRAY_JSON')) {
    return <TemplateEditor key={template.uuid} template={template} hash={hash} />
  }
  // Остальные YAML-типы держат содержимое в encodedTemplateYaml, а разбирать
  // его редактор умеет только по правилам Mihomo; XRAY_BASE64 и SINGBOX — свои
  // форматы. Открыть их нельзя, и молчать об этом — худшее из решений
  return (
    <main style={{ padding: 24 }}>
      <p>
        Редактор умеет шаблоны XRAY_JSON и MIHOMO, а «{template.name}» —{' '}
        {template.templateType}. Откройте его в панели Remnawave.
      </p>
      {back}
    </main>
  )
}

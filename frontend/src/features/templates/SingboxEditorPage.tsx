// Сборка редактора шаблона sing-box поверх хрома `EditorShell` — третья сестра
// `Workbench` (Xray-профиль и Xray-шаблон) и `MihomoEditorPage`. Монтирует её
// `TemplateEditorPage`: тип шаблона известен только после загрузки, поэтому
// маршрут у всех трёх редакторов шаблона один — /templates/:uuid.
//
// Отличий от шаблона Mihomo три, и все они следуют из того, что содержимое
// хранится ОБЪЕКТОМ в `templateJson`:
//   1. раскодирования нет вовсе — `atob` не участвует, белого экрана не будет;
//   2. сохранение шлёт `templateJson`, а не `encodedTemplateYaml`;
//   3. сохранение блокирует ЛЮБАЯ ошибка, а не только синтаксис (см. ниже).

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ConflictError,
  useSaveTemplate,
  type SubscriptionTemplate,
  type TemplateOfType,
} from '../../shared/api'
import { Button, Dialog, EmptyState } from '../../shared/ui'
import { EditorShell } from '../editor/EditorShell'
import { SaveDialog } from '../editor/SaveDialog'
import { SingboxJsonView } from '../editor/SingboxJsonView'
import { useSingboxDraft } from '../editor/useSingboxDraft'
import { SingboxCheckDialog } from '../diagnostics/SingboxCheckDialog'
import { SingboxTracePanel } from '../diagnostics/SingboxTracePanel'
import { TraceBar } from '../diagnostics/TraceBar'
import { SingboxInspector } from '../topology/SingboxInspector'
import { SingboxTopology } from '../topology/SingboxTopology'
import { ImportTemplateDialog } from './ImportTemplateDialog'

/**
 * Пустое содержимое — константа, а не литерал в пропе: литерал был бы новым по
 * ссылке на каждый рендер и сбрасывал бы мемоизацию форматирования в черновике.
 */
const EMPTY_SINGBOX: Record<string, never> = {}

/** Состояние конфликта: хэш здесь уже сужен до строки — без него перезаписывать нечем */
interface ConflictState {
  template: SubscriptionTemplate
  hash: string
}

/**
 * `templateJson` панели — словарь только у заполненного шаблона. `null` (шаблон,
 * заведённый в панели и ни разу не наполненный), массив и примитив документом
 * sing-box не являются, и открывать их как документ незачем.
 */
function isDictionary(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function SingboxEditorPage({
  template,
  hash,
}: {
  template: TemplateOfType<'SINGBOX'>
  hash: string
}) {
  const qc = useQueryClient()
  const hasContent = isDictionary(template.templateJson)
  const draft = useSingboxDraft({
    docKey: template.uuid,
    panelJson: hasContent ? template.templateJson : EMPTY_SINGBOX,
    baseVersion: hash,
  })
  const save = useSaveTemplate(template.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const doc = draft.doc

  function doSave(expectedHash: string) {
    save.mutate(
      // В панель уходит РАЗОБРАННЫЙ текст черновика, а не результат схемы:
      // человек правит текст, и отправить вместо него модель значило бы
      // отправить не тот документ, который он видел. Поле ровно одно:
      // encodedTemplateYaml на JSON-шаблоне бэкенд отвергает четырёхсотым, и
      // слать оба значило бы спрятать эту защиту от себя же
      { templateJson: draft.json, expectedHash },
      {
        onSuccess: () => {
          draft.clearAfterSave()
          setSaveOpen(false)
          setConflict(null)
        },
        onError: (err) => {
          if (err instanceof ConflictError) {
            setSaveOpen(false)
            // Роут шаблонов кладёт в `current` шаблон, а рядом — его хэш. Хэш
            // считает только бэкенд; без него версия панели бесполезна —
            // перезаписывать нечем, поэтому просто перечитываем шаблон
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
  // {template, hash} с уже заполненным templateJson, hasContent пересчитается
  const emptyNotice = !hasContent ? (
    <span className="field-warning">
      Шаблон в панели пуст — редактор открыл его как пустой документ. Сохранение запишет в
      панель то, что вы здесь соберёте.
    </span>
  ) : undefined

  // У Mihomo сохранение блокирует только синтаксис: там почти все диагностики —
  // предупреждения об именах, которых редактор знать не может. Здесь наоборот:
  // все ошибки sing-box (кольцо групп, дубль тега, отсутствующий rule_set,
  // ссылка в пустоту у документа без серверов от панели) — дефекты, которые
  // панель не починит, и сохранять их значит отдать клиенту заведомо сломанную
  // подписку.
  const blocked = draft.hasErrors

  const canvas =
    doc === undefined ? (
      <div className="wb-canvas wb-canvas-empty">
        <EmptyState
          title="Документ не разбирается"
          hint="Поправьте текст на вкладке JSON — топология строится по разобранному документу."
        />
      </div>
    ) : (
      <>
        <div className="wb-canvas">
          <SingboxTopology
            draft={draft}
            doc={doc}
            dockExtra={
              <Button aria-pressed={draft.traceOpen} onClick={draft.toggleTrace}>
                Куда пойдёт трафик
              </Button>
            }
            dockRow={
              draft.traceOpen ? (
                // Строка ввода общая с Xray и Mihomo: она работает с TraceTarget
                // и о виде документа ничего не знает. Поле процесса не
                // включаем — правил по процессу sing-box не проверяет
                // (`process_*` останавливают проход), и оно приглашало бы
                // заполнить то, на что ни одно правило не посмотрит
                <TraceBar value={draft.traceTarget} onChange={draft.setTraceTarget} />
              ) : undefined
            }
          />
        </div>
        {draft.trace && (
          <SingboxTracePanel
            result={draft.trace}
            onClose={() => draft.setTraceTarget(null)}
            onSelectRule={(index) => draft.setSelectedNode(`rule:${index}`)}
          />
        )}
        {draft.selectedNode && (
          <SingboxInspector key={draft.selectedNode} draft={draft} doc={doc} nodeId={draft.selectedNode} />
        )}
      </>
    )

  return (
    <EditorShell
      draft={draft}
      kind="templates"
      back={{ to: '/templates', label: '← Шаблоны' }}
      title={template.name}
      subtitle={`шаблон ${template.templateType}`}
      tabs={{ graph: 'Топология' }}
      // Диалект JSON: подпись вкладки и выгрузка у него общие с Xray, а вот
      // ЗАГРУЖЕННЫЙ файл разбирается своим разбором — конфиг Xray в редакторе
      // sing-box обязан быть отвергнут, а не молча стать черновиком
      docFormat="singbox-json"
      // «Конфиг валиден» здесь соврало бы: документ — клиентская подписка, а не
      // конфиг ядра ноды, и валидность его подтверждает sing-box, а не редактор
      validLabel="Документ разбирается, замечаний нет"
      actions={
        <>
          <Button variant="ghost" onClick={() => draft.setCheckOpen(true)}>
            Проверить ядром
          </Button>
          <Button variant="ghost" onClick={() => draft.setImportOpen(true)}>
            Импорт
          </Button>
        </>
      }
      statusExtra={saveError ? <span className="field-error">{saveError}</span> : emptyNotice}
      canvas={canvas}
      textView={
        <div className="wb-canvas">
          <SingboxJsonView
            text={draft.text}
            reveal={draft.reveal}
            onChange={(value) => draft.writeDraft(value, { history: false })}
          />
        </div>
      }
      save={
        <Button
          variant="primary"
          disabled={blocked || !draft.dirty || save.isPending}
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
        issues={draft.issues}
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
            disabled={save.isPending || blocked}
            onClick={() => {
              // Хэш берём из тела 409, а не из базы черновика: повтори мы её —
              // конфликт не разрешился бы уже никогда
              if (conflict) doSave(conflict.hash)
            }}
          >
            Перезаписать
          </Button>
        </div>
      </Dialog>

      {/* Проверяется ТЕКСТ черновика, а не модель: ядру нужен ровно тот
          документ, что уедет в панель */}
      <SingboxCheckDialog
        open={draft.checkOpen}
        text={draft.text}
        onClose={() => draft.setCheckOpen(false)}
      />

      <ImportTemplateDialog
        open={draft.importOpen}
        docType={template.templateType}
        dirty={draft.dirty}
        onImport={(content) => {
          // Импорт — правка черновика, а не запись в панель: пользователь видит
          // шаблон в редакторе, может отменить его через Ctrl+Z и сам решает,
          // сохранять ли. Выбор снимаем: документ заменён целиком, а узлы
          // адресуются позицией правила и тегом выхода — старый указывал бы уже
          // не туда
          draft.writeDraft(content, { history: true })
          draft.setSelectedNode(null)
        }}
        onClose={() => draft.setImportOpen(false)}
      />
    </EditorShell>
  )
}

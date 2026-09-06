// Сборка редактора шаблона Mihomo поверх хрома `EditorShell` — сестра
// `Workbench` (сборка Xray) и `TemplateEditorPage` (страница Xray-шаблона).
// Отличий от Xray-шаблона ровно четыре:
//   1. содержимое приходит base64-строкой в `encodedTemplateYaml`;
//   2. сохранение шлёт `encodedTemplateYaml`, а не `templateJson`;
//   3. подпись текстовой вкладки — «YAML», а «Конфиг валиден» в статус-баре
//      заменено на правду о шаблоне подписки: конфигом ядра он не является;
//   4. сохранение блокирует не любая ошибка, а только синтаксис YAML.
// Смонтировать её — дело `TemplateEditorPage`: тип шаблона известен лишь после
// загрузки, поэтому маршрут у обоих редакторов один — /templates/:uuid.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ConflictError, useSaveTemplate, type SubscriptionTemplate } from '../../shared/api'
import { YAML_SYNTAX_PREFIX } from '../../entities/mihomo'
import { decodeYaml, encodeYaml } from '../../shared/lib/base64'
import { Button, Dialog, EmptyState } from '../../shared/ui'
import { EditorShell } from '../editor/EditorShell'
import { MihomoSectionsDialog } from '../editor/MihomoSectionsDialog'
import { SaveDialog } from '../editor/SaveDialog'
import { useMihomoDraft } from '../editor/useMihomoDraft'
import { YamlView } from '../editor/YamlView'
import { GeoDataDialog } from '../diagnostics/GeoDataDialog'
import { MihomoInspector } from '../topology/MihomoInspector'
import { MihomoTopology } from '../topology/MihomoTopology'

/** Состояние конфликта: хэш здесь уже сужен до строки — без него перезаписывать нечем */
interface ConflictState {
  template: SubscriptionTemplate
  hash: string
}

export function MihomoEditorPage({
  template,
  hash,
}: {
  template: SubscriptionTemplate
  hash: string
}) {
  const qc = useQueryClient()
  // Шаблон, заведённый в панели и ни разу не заполненный вторым шагом создания,
  // приходит с `encodedTemplateYaml: null` — открываем его пустым документом и
  // говорим об этом в статус-баре, как это делает редактор Xray-шаблона
  const panelText =
    template.encodedTemplateYaml === null ? '' : decodeYaml(template.encodedTemplateYaml)
  const draft = useMihomoDraft({ docKey: template.uuid, panelText, baseVersion: hash })
  const save = useSaveTemplate(template.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const md = draft.md

  function doSave(expectedHash: string) {
    save.mutate(
      // Текст черновика уходит как есть: печатать документ модели обратно
      // нельзя — круг через объект стирает якоря и комментарий-маркер
      { encodedTemplateYaml: encodeYaml(draft.text), expectedHash },
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
  // {template, hash} с уже заполненным encodedTemplateYaml
  const emptyNotice =
    template.encodedTemplateYaml === null ? (
      <span className="field-warning">
        Шаблон в панели пуст — редактор открыл его как пустой документ. Сохранение запишет в
        панель то, что вы здесь соберёте.
      </span>
    ) : undefined

  // У Mihomo, в отличие от Xray, сохранение НЕ блокируется по `hasErrors`:
  // почти все диагностики — предупреждения об именах, которых редактор знать не
  // может (их даёт панель по примечаниям хоста). Блокирует ровно синтаксис:
  // документ, который не разбирается, панель примет, а подписка сломается.
  const blockedBySyntax = draft.issues.some(
    (i) => i.level === 'error' && i.message.startsWith(YAML_SYNTAX_PREFIX),
  )

  const canvas =
    md === undefined ? (
      <div className="wb-canvas wb-canvas-empty">
        <EmptyState
          title="Документ пуст"
          hint="Впишите секции на вкладке YAML или загрузите готовый шаблон — топология строится по разобранному документу."
        />
      </div>
    ) : (
      <>
        <div className="wb-canvas">
          <MihomoTopology draft={draft} md={md} />
        </div>
        {draft.selectedNode && (
          <MihomoInspector
            key={draft.selectedNode}
            draft={draft}
            md={md}
            nodeId={draft.selectedNode}
          />
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
      tabs={{ graph: 'Топология', text: 'YAML' }}
      // «Конфиг валиден» здесь соврало бы: документ — клиентская подписка, а не
      // конфиг ядра ноды, и валидность его подтверждает mihomo, а не редактор
      validLabel="Документ разбирается, замечаний нет"
      actions={
        <>
          <Button
            variant="ghost"
            disabled={md === undefined}
            onClick={() => draft.setSectionsOpen(true)}
          >
            Секции документа
          </Button>
          <Button variant="ghost" onClick={() => draft.setCheckOpen(true)}>
            Проверить ядром
          </Button>
          <Button variant="ghost" onClick={() => draft.setImportOpen(true)}>
            Импорт
          </Button>
          <Button variant="ghost" onClick={() => draft.setGeoOpen(true)}>
            Geo-базы
          </Button>
        </>
      }
      statusExtra={saveError ? <span className="field-error">{saveError}</span> : emptyNotice}
      canvas={canvas}
      textView={
        <div className="wb-canvas">
          <YamlView
            text={draft.text}
            reveal={draft.reveal}
            onChange={(value) => draft.writeDraft(value, { history: false })}
          />
        </div>
      }
      save={
        <Button
          variant="primary"
          disabled={blockedBySyntax || !draft.dirty || save.isPending}
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
            disabled={save.isPending || blockedBySyntax}
            onClick={() => {
              if (conflict) doSave(conflict.hash)
            }}
          >
            Перезаписать
          </Button>
        </div>
      </Dialog>

      {md !== undefined && (
        <MihomoSectionsDialog
          open={draft.sectionsOpen}
          md={md}
          draft={draft}
          onClose={() => draft.setSectionsOpen(false)}
        />
      )}

      {/* Без «В правило»: приписать geo-ключ к правилу Mihomo умеет текст, а не
          этот диалог — его кнопка ведёт в мутации графа Xray */}
      <GeoDataDialog open={draft.geoOpen} onClose={() => draft.setGeoOpen(false)} />
    </EditorShell>
  )
}

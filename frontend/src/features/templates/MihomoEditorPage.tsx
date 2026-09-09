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
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ConflictError,
  useSaveTemplate,
  type SubscriptionTemplate,
  type TemplateOfType,
} from '../../shared/api'
import { parseMihomo, YAML_SYNTAX_PREFIX } from '../../entities/mihomo'
import { decodeYamlOrNull, encodeYaml } from '../../shared/lib/base64'
import { Button, Dialog } from '../../shared/ui'
import { EditorShell } from '../editor/EditorShell'
import { SaveDialog } from '../editor/SaveDialog'
import { useMihomoDraft } from '../editor/useMihomoDraft'
import { YamlView } from '../editor/YamlView'
import { GeoDataDialog } from '../diagnostics/GeoDataDialog'
import { MihomoCheckDialog } from '../diagnostics/MihomoCheckDialog'
import { MihomoTracePanel } from '../diagnostics/MihomoTracePanel'
import { RuleSetsDialog } from '../diagnostics/RuleSetsDialog'
import { TraceBar } from '../diagnostics/TraceBar'
import { RecipesDialog } from '../recipes/RecipesDialog'
import { MIHOMO_RECIPE_ENTRIES } from '../recipes/mihomoRecipes'
import { ImportTemplateDialog } from './ImportTemplateDialog'
import { MihomoInspector } from '../topology/MihomoInspector'
import { MihomoTopology } from '../topology/MihomoTopology'

/** Состояние конфликта: хэш здесь уже сужен до строки — без него перезаписывать нечем */
interface ConflictState {
  template: SubscriptionTemplate
  hash: string
}

/**
 * Раскодирование содержимого — до всех хуков редактора и отдельной компонентой:
 * `atob` бросает на строке, которая не base64, а ErrorBoundary в приложении нет,
 * то есть исключение здесь — белый экран вместо документа. Шаблон, заведённый в
 * панели и ни разу не заполненный, приходит с `encodedTemplateYaml: null` — это
 * не поломка, а пустой документ (см. decodeYamlOrNull).
 */
export function MihomoEditorPage({
  template,
  hash,
}: {
  template: TemplateOfType<'MIHOMO'>
  hash: string
}) {
  const navigate = useNavigate()
  const panelText = decodeYamlOrNull(template.encodedTemplateYaml)
  if (panelText === null) {
    return (
      <main style={{ padding: 24 }}>
        <p className="field-error">
          Содержимое шаблона «{template.name}» не читается: панель вернула
          encodedTemplateYaml, который не является base64. Открывать его редактором нечем —
          посмотрите шаблон в панели Remnawave.
        </p>
        <Button variant="ghost" onClick={() => navigate('/templates')}>
          ← Шаблоны
        </Button>
      </main>
    )
  }
  return <MihomoEditor template={template} hash={hash} panelText={panelText} />
}

function MihomoEditor({
  template,
  hash,
  panelText,
}: {
  template: TemplateOfType<'MIHOMO'>
  hash: string
  /** Уже раскодированный документ панели: пустая строка у незаполненного шаблона */
  panelText: string
}) {
  const qc = useQueryClient()
  const draft = useMihomoDraft({ docKey: template.uuid, panelText, baseVersion: hash })
  const save = useSaveTemplate(template.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  // Адаптер (mihomoAdapter.parse) отдаёт модель ВСЕГДА, включая пустой документ —
  // это законная точка старта «с нуля». `DocumentDraft.model` при этом типизирован
  // `T | undefined` для ядер, где документ может не разобраться вовсе; здесь
  // такого не бывает, и запасное значение — только чтобы типы сошлись
  const md = draft.md ?? parseMihomo('')

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

  // Модель есть всегда (см. md выше), включая пустой документ — законную
  // отправную точку «с нуля»: холст рисуется и на ней, с кнопкой «+ Добавить»
  // в доке, а не гаснет пустым состоянием
  const canvas = (
    <>
      <div className="wb-canvas">
        <MihomoTopology
          draft={draft}
          md={md}
          dockExtra={
            <Button aria-pressed={draft.traceOpen} onClick={draft.toggleTrace}>
              Куда пойдёт трафик
            </Button>
          }
          dockRow={
            draft.traceOpen ? (
              // Строка ввода общая с Xray: она работает с TraceTarget и о виде
              // документа ничего не знает. Поле процесса включаем здесь —
              // правила `PROCESS-*` есть только у Mihomo
              <TraceBar value={draft.traceTarget} onChange={draft.setTraceTarget} showProcess />
            ) : undefined
          }
        />
      </div>
      {draft.trace && (
        <MihomoTracePanel
          result={draft.trace}
          onClose={() => draft.setTraceTarget(null)}
          onSelectRule={(index) => draft.setSelectedNode(`rule:${index}`)}
          onOpenGeo={() => draft.setGeoOpen(true)}
        />
      )}
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
      tabs={{ graph: 'Топология' }}
      // Содержимое документа — YAML-текст. Отсюда и подпись текстовой вкладки, и
      // то, из какого поля бэкапа диалог версий берёт документ и чем выгружает
      docFormat="yaml"
      // «Конфиг валиден» здесь соврало бы: документ — клиентская подписка, а не
      // конфиг ядра ноды, и валидность его подтверждает mihomo, а не редактор
      validLabel="Документ разбирается, замечаний нет"
      actions={
        <>
          <Button variant="ghost" onClick={() => draft.setCheckOpen(true)}>
            Проверить ядром
          </Button>
          <Button variant="ghost" onClick={() => draft.setImportOpen(true)}>
            Импорт
          </Button>
          <Button variant="ghost" onClick={() => draft.setRecipesOpen(true)}>
            Рецепты
          </Button>
          <Button variant="ghost" onClick={() => draft.setGeoOpen(true)}>
            Geo-базы
          </Button>
          <Button variant="ghost" onClick={() => draft.setRuleSetsOpen(true)}>
            Наборы правил
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

      {/* Как и импорт, рецепт правит черновик, а не панель напрямую: план
          считается по разобранной модели, а в текст возвращается через
          writeDraft с записью в историю (Ctrl+Z отменяет) */}
      <RecipesDialog
        open={draft.recipesOpen}
        model={md}
        entries={MIHOMO_RECIPE_ENTRIES}
        print={(m) => m.text}
        onApply={(next) => {
          // Как импорт и отмена/возврат: рецепт может вставить и сдвинуть
          // правила по индексу, а выбранный узел адресуется позицией — старый
          // выбор после этого указывал бы уже не туда
          draft.writeDraft(next.text, { history: true })
          draft.setSelectedNode(null)
          draft.setRecipesOpen(false)
        }}
        onClose={() => draft.setRecipesOpen(false)}
      />

      {/* Проверяется ТЕКСТ черновика, а не модель: печатать документ обратно
          нельзя, да и ядру нужен ровно тот документ, что уедет в панель */}
      <MihomoCheckDialog
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
          // адресуются позицией правила и именем группы — старый указывал бы
          // уже не туда
          draft.writeDraft(content, { history: true })
          draft.setSelectedNode(null)
        }}
        onClose={() => draft.setImportOpen(false)}
      />

      {/* Без «В правило»: приписать geo-ключ к правилу Mihomo умеет текст, а не
          этот диалог — его кнопка ведёт в мутации графа Xray */}
      <GeoDataDialog open={draft.geoOpen} onClose={() => draft.setGeoOpen(false)} />

      <RuleSetsDialog
        open={draft.ruleSetsOpen}
        onClose={() => draft.setRuleSetsOpen(false)}
        sets={draft.ruleSets}
        asked={draft.askedSets}
      />
    </EditorShell>
  )
}

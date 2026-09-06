// Сборка редактора Xray поверх хрома `EditorShell`: канвас с топологией,
// инспектор узла, панель разбора трассы, текстовая вкладка JSON и диалоги,
// которые есть только у Xray-документа («Настройки конфига», «Geo-базы»).
// Всё, что одинаково у любого документа — топбар, статус-бар, версии, сброс
// черновика, — живёт в `EditorShell` и о конфиге не знает.
// Страница добавляет только своё: заголовок, кнопки топбара, сохранение и рецепты.

import { type ReactNode } from 'react'
import { Button, EmptyState } from '../../shared/ui'
import { TopologyView } from '../topology/TopologyView'
import { SearchBox } from '../topology/SearchBox'
import { NodeInspector } from '../topology/NodeInspector'
import { TraceBar } from '../diagnostics/TraceBar'
import { TracePanel } from '../diagnostics/TracePanel'
import { GeoDataDialog } from '../diagnostics/GeoDataDialog'
import type { ConfigDraft } from './useConfigDraft'
import { EditorShell } from './EditorShell'
import { ConfigSettingsDialog } from './ConfigSettingsDialog'
import { JsonView } from './JsonView'

export interface WorkbenchProps {
  draft: ConfigDraft
  /** Вид документа: путь бэкапов панели (/api/<kind>/…). Адрес возврата задаёт back.to */
  kind: 'profiles' | 'templates'
  /** Куда ведёт кнопка возврата и что на ней написано */
  back: { to: string; label: string }
  title: string
  /** Строка под заголовком: «обновлён N минут назад» либо тип шаблона */
  subtitle?: string
  /** Кнопки топбара между сегментами и «Сохранить» (специфичные для страницы) */
  actions?: ReactNode
  /** Кнопка сохранения целиком: условия и диалоги у профиля и шаблона разные */
  save?: ReactNode
  /** Библиотека рецептов: у шаблона её нет, кнопка не появляется */
  onOpenRecipes?: () => void
  /** Группы подстановки: секция remnawave бывает только у шаблона — у профиля кнопки нет */
  allowInject?: boolean
  /** Правая часть статус-бара: текст ошибки сохранения приходит из мутации страницы */
  statusExtra?: ReactNode
  /** Диалоги страницы: сохранение, конфликт, проверка ядром */
  children?: ReactNode
}

export function Workbench({
  draft,
  kind,
  back,
  title,
  subtitle,
  actions,
  save,
  onOpenRecipes,
  allowInject,
  statusExtra,
  children,
}: WorkbenchProps) {
  const parsedConfig = draft.parsedConfig

  // Обе кнопки специфичны для Xray-документа, поэтому приходят в хром слотом.
  // Порядок в топбаре прежний: «Настройки конфига», кнопки страницы, «Geo-базы»
  const topbarActions = (
    <>
      <Button
        variant="ghost"
        disabled={parsedConfig === undefined}
        onClick={() => draft.setSettingsOpen(true)}
      >
        Настройки конфига
      </Button>
      {actions}
      <Button variant="ghost" onClick={() => draft.setGeoOpen(true)}>
        Geo-базы
      </Button>
    </>
  )

  const canvas =
    parsedConfig === undefined ? (
      <div className="wb-canvas wb-canvas-empty">
        <EmptyState
          title="Конфиг не проходит валидацию"
          hint="Исправьте ошибки на вкладке JSON — топология строится по валидному документу."
        />
      </div>
    ) : (
      <>
        <div className="wb-canvas">
          <TopologyView
            docKey={draft.storageKey}
            config={parsedConfig}
            ctx={draft.ctx}
            selectedId={draft.selectedNode}
            onSelect={draft.setSelectedNode}
            onChangeConfig={draft.changeConfig}
            trace={draft.trace}
            issues={draft.nodeIssues}
            focus={draft.focus}
            onOpenRecipes={onOpenRecipes}
            allowInject={allowInject}
            dockExtra={
              <>
                <SearchBox
                  query={draft.searchQuery}
                  hits={draft.searchHits}
                  focusSignal={draft.searchFocus}
                  onQuery={draft.setSearchQuery}
                  onPick={draft.focusNode}
                />
                <Button aria-pressed={draft.traceOpen} onClick={draft.toggleTrace}>
                  Куда пойдёт трафик
                </Button>
              </>
            }
            dockRow={
              draft.traceOpen ? (
                <TraceBar value={draft.traceTarget} onChange={draft.setTraceTarget} />
              ) : undefined
            }
          />
        </div>
        {draft.trace && (
          <TracePanel
            result={draft.trace}
            onClose={() => draft.setTraceTarget(null)}
            onSelectRule={(index) => draft.setSelectedNode(`rule:${index}`)}
            onOpenGeo={() => draft.setGeoOpen(true)}
          />
        )}
        {draft.selectedNode && (
          <NodeInspector
            key={draft.selectedNode}
            config={parsedConfig}
            nodeId={draft.selectedNode}
            inboundSquads={draft.ctx.inboundSquads}
            onApply={draft.applyNode}
            onMoveRule={draft.moveSelected}
            onRemove={draft.removeSelected}
            onSetupObservatory={draft.setupObservatory}
            onClose={() => draft.setSelectedNode(null)}
          />
        )}
      </>
    )

  const textView = (
    <div className="wb-canvas">
      <JsonView
        text={draft.text}
        reveal={draft.reveal}
        onChange={(value) => draft.writeDraft(value, { history: false })}
      />
    </div>
  )

  return (
    <EditorShell
      draft={draft}
      kind={kind}
      back={back}
      title={title}
      subtitle={subtitle}
      tabs={{ graph: 'Топология', text: 'JSON' }}
      actions={topbarActions}
      save={save}
      statusExtra={statusExtra}
      canvas={canvas}
      textView={textView}
    >
      {parsedConfig !== undefined && (
        <ConfigSettingsDialog
          open={draft.settingsOpen}
          config={parsedConfig}
          onChange={draft.changeConfig}
          onClose={() => draft.setSettingsOpen(false)}
        />
      )}

      <GeoDataDialog
        open={draft.geoOpen}
        onClose={() => draft.setGeoOpen(false)}
        onUseKey={draft.appendGeoKeyToRule}
      />

      {children}
    </EditorShell>
  )
}

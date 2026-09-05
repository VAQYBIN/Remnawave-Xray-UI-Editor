// Оболочка редактора: всё, что одинаково у профиля и шаблона подписки — вкладки,
// канвас с инспектором, панель разбора трассы, список проблем и общие диалоги.
// Страница добавляет только своё: заголовок, кнопки топбара, сохранение и рецепты.

import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { usePanelToken } from '../../shared/api'
import { Button, Chip, Dialog, EmptyState } from '../../shared/ui'
import { TopologyView } from '../topology/TopologyView'
import { SearchBox } from '../topology/SearchBox'
import { NodeInspector } from '../topology/NodeInspector'
import { TraceBar } from '../diagnostics/TraceBar'
import { TracePanel } from '../diagnostics/TracePanel'
import { GeoDataDialog } from '../diagnostics/GeoDataDialog'
import type { ConfigDraft } from './useConfigDraft'
import { VersionsDialog } from './VersionsDialog'
import { ConfigSettingsDialog } from './ConfigSettingsDialog'
import { IssueList } from './IssueList'
import { PanelTokenNotice } from './PanelTokenNotice'
import { JsonView } from './JsonView'
import { ShortcutsDialog } from './ShortcutsDialog'

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
  const navigate = useNavigate()
  const panelToken = usePanelToken()
  const parsedConfig = draft.parsedConfig
  // Версии и сброс черновика — целиком дело оболочки: странице о них знать нечего
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  return (
    <div className="workbench">
      <header className="wb-topbar">
        <Button variant="ghost" onClick={() => navigate(back.to)}>
          {back.label}
        </Button>
        <div className="wb-title">
          <h1>{title}</h1>
          {subtitle && <span className="eyebrow">{subtitle}</span>}
        </div>

        <div className="wb-iconbar">
          <Button
            aria-label="Отменить"
            title="Отменить (Ctrl+Z)"
            disabled={!draft.undoAvailable}
            onClick={draft.doUndo}
          >
            ↶
          </Button>
          <Button
            aria-label="Вернуть"
            title="Вернуть (Ctrl+Shift+Z)"
            disabled={!draft.redoAvailable}
            onClick={draft.doRedo}
          >
            ↷
          </Button>
          <Button
            aria-label="Горячие клавиши"
            title="Горячие клавиши (?)"
            onClick={() => draft.setShortcutsOpen(true)}
          >
            ?
          </Button>
        </div>

        <div className="segmented">
          <Button aria-pressed={draft.tab === 'topology'} onClick={draft.openTopologyTab}>
            Топология
          </Button>
          <Button aria-pressed={draft.tab === 'json'} onClick={draft.openJsonTab}>
            JSON
          </Button>
        </div>

        <span className="spacer" />
        {draft.dirty && <Chip dir="none">черновик</Chip>}
        <Button variant="ghost" disabled={parsedConfig === undefined} onClick={() => draft.setSettingsOpen(true)}>
          Настройки конфига
        </Button>
        {actions}
        <Button variant="ghost" onClick={() => draft.setGeoOpen(true)}>
          Geo-базы
        </Button>
        <Button variant="ghost" onClick={() => setVersionsOpen(true)}>
          Версии
        </Button>
        <Button variant="ghost" disabled={!draft.dirty} onClick={() => setResetOpen(true)}>
          Сбросить к версии панели
        </Button>
        {save}
      </header>

      <div className="wb-stage">
        {draft.tab === 'json' && (
          <div className="wb-canvas">
            <JsonView
              text={draft.text}
              reveal={draft.reveal}
              onChange={(value) => draft.writeDraft(value, { history: false })}
            />
          </div>
        )}
        {draft.tab === 'topology' && parsedConfig === undefined && (
          <div className="wb-canvas wb-canvas-empty">
            <EmptyState
              title="Конфиг не проходит валидацию"
              hint="Исправьте ошибки на вкладке JSON — топология строится по валидному документу."
            />
          </div>
        )}
        {draft.tab === 'topology' && parsedConfig !== undefined && (
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
        )}
      </div>

      <footer className="wb-statusbar">
        <div className="wb-status-head">
          {draft.validation.issues.length === 0 ? (
            <span className="muted">Конфиг валиден</span>
          ) : (
            <button
              type="button"
              className="wb-status-toggle"
              aria-expanded={draft.issuesOpen}
              onClick={() => draft.setIssuesOpen(!draft.issuesOpen)}
            >
              <span className="collapsible-marker" aria-hidden="true">
                ▸
              </span>
              {draft.errorCount > 0 && <span className="field-error">ошибок: {draft.errorCount}</span>}
              {draft.errorCount > 0 && draft.warningCount > 0 && <span aria-hidden="true">·</span>}
              {draft.warningCount > 0 && <span className="field-warning">предупреждений: {draft.warningCount}</span>}
            </button>
          )}
          <span className="spacer" />
          <PanelTokenNotice status={panelToken.data} />
          {statusExtra}
        </div>
        {draft.issuesOpen && draft.validation.issues.length > 0 && (
          <div className="wb-status-body">
            <IssueList
              issues={draft.validation.issues}
              onSelect={draft.selectIssue}
              canSelect={draft.canSelectIssue}
            />
          </div>
        )}
      </footer>

      <Dialog open={resetOpen} title="Сбросить черновик" onClose={() => setResetOpen(false)}>
        <p>Отменить все локальные правки и вернуться к версии из панели?</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setResetOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              draft.resetDraft()
              setResetOpen(false)
            }}
          >
            Сбросить
          </Button>
        </div>
      </Dialog>

      {parsedConfig !== undefined && (
        <ConfigSettingsDialog
          open={draft.settingsOpen}
          config={parsedConfig}
          onChange={draft.changeConfig}
          onClose={() => draft.setSettingsOpen(false)}
        />
      )}

      <ShortcutsDialog open={draft.shortcutsOpen} onClose={() => draft.setShortcutsOpen(false)} />

      <GeoDataDialog
        open={draft.geoOpen}
        onClose={() => draft.setGeoOpen(false)}
        onUseKey={draft.appendGeoKeyToRule}
      />

      <VersionsDialog
        open={versionsOpen}
        kind={kind}
        docUuid={draft.docKey}
        docName={title}
        currentText={draft.text}
        onRestore={(configText) => {
          draft.writeDraft(configText, { history: true })
          draft.setSelectedNode(null)
        }}
        onClose={() => setVersionsOpen(false)}
      />

      {/* Только модальные <dialog>: .workbench — grid из трёх строк, и узел,
          оставшийся в потоке, добавит четвёртую и сожмёт сцену */}
      {children}
    </div>
  )
}

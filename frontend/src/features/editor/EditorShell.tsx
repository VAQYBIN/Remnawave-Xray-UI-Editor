// Хром редактора: топбар, сцена, статус-бар и диалоги, одинаковые у любого
// документа — Xray-конфига профиля, Xray-шаблона подписки и шаблона Mihomo.
// О виде документа хром не знает ничего: канвас и текстовая вкладка приходят
// слотами (`canvas`/`textView`), подписи сегментов — пропсом `tabs`, а всё
// специфичное для документа (например «Настройки конфига» и «Geo-базы») —
// слотом `actions` от сборки поверх хрома.

import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { usePanelToken } from '../../shared/api'
import { Button, Chip, Dialog } from '../../shared/ui'
import type { EditorShellDraft } from './useDocumentDraft'
import { VersionsDialog } from './VersionsDialog'
import { IssueList } from './IssueList'
import { PanelTokenNotice } from './PanelTokenNotice'
import { ShortcutsDialog } from './ShortcutsDialog'

export interface EditorShellProps {
  /** Черновик без модели: хром читает только документо-независимые поля */
  draft: EditorShellDraft
  /** Вид документа: путь бэкапов панели (/api/<kind>/…). Адрес возврата задаёт back.to */
  kind: 'profiles' | 'templates'
  /** Куда ведёт кнопка возврата и что на ней написано */
  back: { to: string; label: string }
  title: string
  /** Строка под заголовком: «обновлён N минут назад» либо тип шаблона */
  subtitle?: string
  /** Подписи сегментов: текстовая вкладка у Xray «JSON», у Mihomo «YAML» */
  tabs: { graph: string; text: string }
  /**
   * Формат СОДЕРЖИМОГО документа — не то же, что подпись вкладки выше. От него
   * зависит диалог версий: из какого поля бэкапа брать текст, чем выгружать в
   * файл и что принимать при загрузке. Умолчание `json` оставляет редактор Xray
   * ровно таким, каким он был.
   */
  docFormat?: 'json' | 'yaml'
  /**
   * Что сказано в статус-баре, когда проблем нет. Обязателен без умолчания:
   * «Конфиг валиден» верно для Xray, но шаблон подписки Mihomo конфигом не
   * является — умолчание спрятало бы это решение от следующей сборки.
   */
  validLabel: string
  /** Кнопки топбара перед «Версии»: и документо-специфичные, и страничные */
  actions?: ReactNode
  /** Кнопка сохранения целиком: условия и диалоги у профиля и шаблона разные */
  save?: ReactNode
  /** Правая часть статус-бара: текст ошибки сохранения приходит из мутации страницы */
  statusExtra?: ReactNode
  /** Вкладка графа целиком: канвас, инспектор, оверлеи — их собирает вызывающий */
  canvas: ReactNode
  /** Вкладка текста целиком */
  textView: ReactNode
  /** Диалоги сборки и страницы: сохранение, конфликт, проверка ядром */
  children?: ReactNode
}

export function EditorShell({
  draft,
  kind,
  back,
  title,
  subtitle,
  tabs,
  docFormat = 'json',
  validLabel,
  actions,
  save,
  statusExtra,
  canvas,
  textView,
  children,
}: EditorShellProps) {
  const navigate = useNavigate()
  const panelToken = usePanelToken()
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
          <Button aria-pressed={draft.tab === 'graph'} onClick={draft.openGraphTab}>
            {tabs.graph}
          </Button>
          <Button aria-pressed={draft.tab === 'text'} onClick={draft.openTextTab}>
            {tabs.text}
          </Button>
        </div>

        <span className="spacer" />
        {draft.dirty && <Chip dir="none">черновик</Chip>}
        {actions}
        <Button variant="ghost" onClick={() => setVersionsOpen(true)}>
          Версии
        </Button>
        <Button variant="ghost" disabled={!draft.dirty} onClick={() => setResetOpen(true)}>
          Сбросить к версии панели
        </Button>
        {save}
      </header>

      <div className="wb-stage">{draft.tab === 'text' ? textView : canvas}</div>

      <footer className="wb-statusbar">
        <div className="wb-status-head">
          {draft.issues.length === 0 ? (
            <span className="muted">{validLabel}</span>
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
        {draft.issuesOpen && draft.issues.length > 0 && (
          <div className="wb-status-body">
            <IssueList
              issues={draft.issues}
              onSelect={draft.selectIssue}
              canSelect={draft.canSelectIssue}
              emptyLabel={validLabel}
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

      <ShortcutsDialog open={draft.shortcutsOpen} onClose={() => draft.setShortcutsOpen(false)} />

      <VersionsDialog
        open={versionsOpen}
        kind={kind}
        format={docFormat}
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

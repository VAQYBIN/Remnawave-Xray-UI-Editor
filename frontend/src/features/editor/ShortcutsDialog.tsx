import { Button, Dialog } from '../../shared/ui'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+Z', 'Отменить правку (на вкладке JSON — отмена самого редактора)'],
  ['Ctrl+Shift+Z', 'Вернуть отменённое'],
  ['Ctrl+Y', 'Вернуть отменённое'],
  ['Ctrl+F', 'Поиск по конфигу на топологии'],
  ['Esc', 'Закрыть инспектор, панель трассы или результаты поиска'],
  ['?', 'Эта справка'],
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title="Горячие клавиши" onClose={onClose}>
      <dl className="shortcuts-list">
        {SHORTCUTS.map(([combo, what]) => (
          <div key={combo} className="shortcuts-row">
            <dt>{combo}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Сочетания не срабатывают, пока курсор стоит в поле ввода или в JSON-редакторе.
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Dialog>
  )
}

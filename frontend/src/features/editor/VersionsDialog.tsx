import { useRef, useState, type ChangeEvent } from 'react'
import { apiFetch, useBackups, type BackupFileData } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog } from '../../shared/ui'
import { DiffView } from './DiffView'
import { downloadJson, exportFileName, parseImported } from './configFile'

interface Props {
  open: boolean
  profileUuid: string
  profileName: string
  /** Текущий текст черновика: он же уходит в файл и стоит справа в сравнении */
  currentText: string
  onRestore: (configText: string) => void
  onClose: () => void
}

export function VersionsDialog({
  open,
  profileUuid,
  profileName,
  currentText,
  onRestore,
  onClose,
}: Props) {
  const backups = useBackups(profileUuid, open)
  const [tab, setTab] = useState<'backups' | 'file'>('backups')
  const [compare, setCompare] = useState<{ label: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function loadBackup(file: string): Promise<string | null> {
    setBusy(true)
    setError(null)
    try {
      const data = await apiFetch<BackupFileData>(`/api/profiles/${profileUuid}/backups/${file}`)
      return JSON.stringify(data.profile.config, null, 2)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  function apply(text: string) {
    onRestore(text)
    setCompare(null)
    onClose()
  }

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Сбрасываем значение сразу: иначе повторный выбор того же файла не даст change
    event.target.value = ''
    if (!file) return
    const result = parseImported(await file.text())
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    apply(result.text)
  }

  return (
    <Dialog open={open} title="Версии конфига" onClose={onClose} wide={compare !== null}>
      {compare === null ? (
        <>
          <div className="segmented versions-tabs">
            <Button aria-pressed={tab === 'backups'} onClick={() => setTab('backups')}>
              Бэкапы панели
            </Button>
            <Button aria-pressed={tab === 'file'} onClick={() => setTab('file')}>
              Файл
            </Button>
          </div>

          {tab === 'backups' && (
            <>
              <p className="muted">
                Бэкап создаётся автоматически перед каждым сохранением в панель. Восстановление
                кладёт конфиг в черновик — панель изменится только после «Сохранить в панель».
              </p>
              {backups.isPending && <p className="muted">Загрузка…</p>}
              {backups.isError && <p className="field-error">{(backups.error as Error).message}</p>}
              {backups.data && backups.data.length === 0 && <p className="muted">Бэкапов пока нет.</p>}
              {backups.data && backups.data.length > 0 && (
                <div className="backup-list">
                  {backups.data.map((b) => (
                    <div
                      key={b.file}
                      className="row"
                      style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}
                    >
                      <div>
                        <div>{b.profileName}</div>
                        <div className="muted mono" style={{ fontSize: 12 }}>
                          {new Date(b.savedAt).toLocaleString('ru-RU')} · {relativeTime(b.savedAt)}
                        </div>
                      </div>
                      <span className="spacer" />
                      <Button
                        disabled={busy}
                        onClick={async () => {
                          const text = await loadBackup(b.file)
                          if (text !== null) {
                            setCompare({
                              label: `бэкап от ${new Date(b.savedAt).toLocaleString('ru-RU')}`,
                              text,
                            })
                          }
                        }}
                      >
                        Сравнить
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={async () => {
                          const text = await loadBackup(b.file)
                          if (text !== null) apply(text)
                        }}
                      >
                        В черновик
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'file' && (
            <div className="file-tab">
              <p className="muted">
                Скачивание отдаёт текущий текст черновика. Загрузка заменяет черновик целиком —
                отменить можно кнопкой ↶.
              </p>
              <div className="row">
                <Button
                  onClick={() => downloadJson(currentText, exportFileName(profileName, new Date()))}
                >
                  ↓ Скачать JSON
                </Button>
                <Button onClick={() => fileRef.current?.click()}>↑ Загрузить из файла</Button>
              </div>
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept="application/json,.json"
                aria-label="Файл конфига"
                onChange={onPickFile}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Слева — {compare.label}, справа — текущий черновик.
          </p>
          <DiffView original={compare.text} modified={currentText} maxHeight="55vh" />
          <div className="row" style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={() => setCompare(null)}>
              ← К списку
            </Button>
            <span className="spacer" />
            <Button variant="primary" onClick={() => apply(compare.text)}>
              В черновик
            </Button>
          </div>
        </>
      )}

      {error && <span className="field-error">{error}</span>}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Dialog>
  )
}

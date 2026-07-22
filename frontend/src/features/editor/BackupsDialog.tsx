import { useState } from 'react'
import { apiFetch, useBackups, type BackupFileData } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog } from '../../shared/ui'

interface Props {
  open: boolean
  profileUuid: string
  onRestore: (configText: string) => void
  onClose: () => void
}

export function BackupsDialog({ open, profileUuid, onRestore, onClose }: Props) {
  const backups = useBackups(profileUuid, open)
  const [error, setError] = useState<string | null>(null)
  const [busyFile, setBusyFile] = useState<string | null>(null)

  async function restore(file: string) {
    setBusyFile(file)
    setError(null)
    try {
      const data = await apiFetch<BackupFileData>(`/api/profiles/${profileUuid}/backups/${file}`)
      onRestore(JSON.stringify(data.profile.config, null, 2))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyFile(null)
    }
  }

  return (
    <Dialog open={open} title="Бэкапы профиля" onClose={onClose}>
      <p className="muted">
        Бэкап создаётся автоматически перед каждым сохранением в панель. Восстановление кладёт конфиг в
        черновик — панель изменится только после «Сохранить в панель».
      </p>
      {backups.isPending && <p className="muted">Загрузка…</p>}
      {backups.isError && <p className="field-error">{(backups.error as Error).message}</p>}
      {backups.data && backups.data.length === 0 && <p className="muted">Бэкапов пока нет.</p>}
      {backups.data && backups.data.length > 0 && (
        <div className="backup-list">
          {backups.data.map((b) => (
            <div key={b.file} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div>{b.profileName}</div>
                <div className="muted mono" style={{ fontSize: 12 }}>
                  {new Date(b.savedAt).toLocaleString('ru-RU')} · {relativeTime(b.savedAt)}
                </div>
              </div>
              <span className="spacer" />
              <Button disabled={busyFile !== null} onClick={() => restore(b.file)}>
                {busyFile === b.file ? 'Загрузка…' : 'В черновик'}
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && <span className="field-error">{error}</span>}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
    </Dialog>
  )
}

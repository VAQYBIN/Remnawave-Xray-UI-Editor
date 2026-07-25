import { useEffect, useState } from 'react'
import { useGeoStatus, useSaveGeoUrls, useUpdateGeo, type GeoSourceStatus } from '../../shared/api'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog, TextInput } from '../../shared/ui'
import { GeoBrowser } from './GeoBrowser'

const PRESETS = {
  v2fly: {
    geosite: 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat',
    geoip: 'https://github.com/v2fly/geoip/releases/latest/download/geoip.dat',
  },
  loyalsoldier: {
    geosite: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat',
    geoip: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat',
  },
}

function megabytes(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function SourceState({ label, status }: { label: string; status: GeoSourceStatus | undefined }) {
  if (!status) return null
  return (
    <div className="geo-state">
      <span className="geo-state-name">{label}</span>
      {status.present ? (
        <span className="metrics">
          <span className="metric metric-accent">{`категорий: ${status.categories ?? 0}`}</span>
          <span className="metric">{megabytes(status.sizeBytes)}</span>
          {status.loadedAt && (
            <span className="metric">{`обновлена ${relativeTime(status.loadedAt)}`}</span>
          )}
        </span>
      ) : (
        <span className="field-warning">не загружена</span>
      )}
    </div>
  )
}

export function GeoDataDialog({
  open,
  onClose,
  onUseKey,
}: {
  open: boolean
  onClose: () => void
  /** Не передан — просмотр без кнопки «В правило» */
  onUseKey?: (key: string) => void
}) {
  const status = useGeoStatus()
  const save = useSaveGeoUrls()
  const update = useUpdateGeo()
  const [geositeUrl, setGeositeUrl] = useState('')
  const [geoipUrl, setGeoipUrl] = useState('')
  const [tab, setTab] = useState<'sources' | 'browse'>('sources')

  // Поля наполняются, когда приходит статус; правки пользователя не перетираем
  useEffect(() => {
    if (!status.data) return
    setGeositeUrl((v) => (v === '' ? status.data.geosite.url : v))
    setGeoipUrl((v) => (v === '' ? status.data.geoip.url : v))
  }, [status.data])

  function applyPreset(preset: keyof typeof PRESETS) {
    setGeositeUrl(PRESETS[preset].geosite)
    setGeoipUrl(PRESETS[preset].geoip)
  }

  const busy = save.isPending || update.isPending
  const error = (save.error ?? update.error) as Error | undefined

  return (
    <Dialog open={open} title="Geo-базы" onClose={onClose} wide={tab === 'browse'}>
      {/* Закрытый <dialog> всё равно рендерит children: без этого условия поля диалога
          перехватывают поиск по подписям на всей странице */}
      {open && (
        <>
          <div className="segmented versions-tabs">
            <Button aria-pressed={tab === 'sources'} onClick={() => setTab('sources')}>
              Источники
            </Button>
            <Button aria-pressed={tab === 'browse'} onClick={() => setTab('browse')}>
              Просмотр
            </Button>
          </div>

          {tab === 'browse' && (
            <GeoBrowser onUseKey={onUseKey} onOpenSources={() => setTab('sources')} />
          )}

          {tab === 'sources' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Списки нужны трассировщику, чтобы отвечать по условиям{' '}
                <span className="mono">geosite:</span> и <span className="mono">geoip:</span>.
                Держите их теми же, что стоят на нодах — иначе вердикты разойдутся с реальностью.
              </p>

              <SourceState label="geosite" status={status.data?.geosite} />
              <SourceState label="geoip" status={status.data?.geoip} />

              <div className="field">
                <label className="field-label" htmlFor="geo-site-url">
                  Ссылка на geosite
                </label>
                <TextInput
                  id="geo-site-url"
                  value={geositeUrl}
                  onChange={(e) => setGeositeUrl(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="geo-ip-url">
                  Ссылка на geoip
                </label>
                <TextInput
                  id="geo-ip-url"
                  value={geoipUrl}
                  onChange={(e) => setGeoipUrl(e.target.value)}
                />
              </div>

              <div className="row">
                <span className="muted">Пресеты:</span>
                <Button onClick={() => applyPreset('v2fly')}>v2fly</Button>
                <Button onClick={() => applyPreset('loyalsoldier')}>Loyalsoldier</Button>
              </div>

              {error && <p className="field-error">{error.message}</p>}

              <div className="row" style={{ marginTop: 12 }}>
                <span className="spacer" />
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={async () => {
                    await save.mutateAsync({ geositeUrl, geoipUrl })
                    await update.mutateAsync()
                  }}
                >
                  {busy ? 'Загружаю…' : 'Загрузить'}
                </Button>
              </div>
            </>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

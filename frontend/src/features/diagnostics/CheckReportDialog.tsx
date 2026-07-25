import { useEffect, useState } from 'react'
import {
  useRealityProbe,
  useXrayTest,
  type RealityProbeResult,
  type XrayTestResult,
} from '../../shared/api'
import type { RealityTargetRef } from '../../entities/xray'
import { Button, Chip, Dialog } from '../../shared/ui'

function CoreReport({
  result,
  pending,
  error,
  onOpenGeo,
}: {
  result: XrayTestResult | undefined
  pending: boolean
  error: Error | undefined
  onOpenGeo: () => void
}) {
  if (pending) return <p className="muted">Проверяю конфиг ядром…</p>
  if (error) return <p className="field-error">{error.message}</p>
  if (!result) return null

  if (!result.available) {
    return (
      <p className="field-warning">
        Проверка ядром недоступна: бинарь Xray не найден. Путь задаётся переменной{' '}
        <span className="mono">XRAY_BIN</span> — в Docker-образе он уже есть.
      </p>
    )
  }

  return (
    <>
      {result.ok ? (
        <>
          <p className="check-verdict-ok">
            Ядро собирает конфиг без ошибок
            {result.version && <span className="metric">{`версия ${result.version}`}</span>}
          </p>
          <p className="muted check-note">
            Проверка отвечает только за сборку конфига. Ссылки на несуществующие теги ядро
            резолвит в рантайме и здесь не ловит — их разбирает валидация редактора в статус-баре.
          </p>
        </>
      ) : (
        <ul className="check-list" aria-label="Ошибки ядра">
          {result.errors.map((err, i) => (
            <li key={i} className="check-item check-level-error">
              <span className="mono">{err.message}</span>
              {err.line !== undefined && <span className="metric">{`строка ${err.line}`}</span>}
              {err.hint && <span className="check-hint">{err.hint}</span>}
              {err.code === 'geo' && (
                <Button variant="ghost" onClick={onOpenGeo}>
                  Geo-базы
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="check-list check-warnings" aria-label="Предупреждения ядра">
          {result.warnings.map((warning, i) => (
            <li key={i} className="check-item check-level-warn">
              <span className="mono">{warning}</span>
            </li>
          ))}
        </ul>
      )}
      {result.injected.length > 0 && (
        <p className="muted check-note">
          Проверялся конфиг с подставным пользователем в inbound&#39;ах:{' '}
          <span className="mono">{result.injected.join(', ')}</span>. Панель инжектит реальных
          пользователей сама, поэтому в профиле их нет.
        </p>
      )}
    </>
  )
}

function TargetRow({
  target,
  result,
  busy,
  onProbe,
}: {
  target: RealityTargetRef
  result: RealityProbeResult | undefined
  busy: boolean
  onProbe: () => void
}) {
  return (
    <li className="check-target" aria-label={target.inboundTag}>
      <div className="row">
        <Chip dir="in">{target.inboundTag}</Chip>
        <span className="mono">{target.target}</span>
        <span className="spacer" />
        <Button disabled={busy} onClick={onProbe}>
          {busy ? 'Проверяю…' : 'Проверить цель'}
        </Button>
      </div>
      {result && !result.reachable && <p className="field-error">{result.error}</p>}
      {result && result.reachable && (
        <ul className="check-list">
          {result.checks.map((check) => (
            <li key={check.id} className={`check-item check-level-${check.level}`}>
              <span>{check.title}</span>
              {check.detail && <span className="check-hint">{check.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function CheckReportDialog({
  open,
  config,
  targets,
  onClose,
  onOpenGeo,
}: {
  open: boolean
  config: unknown
  targets: RealityTargetRef[]
  onClose: () => void
  onOpenGeo: () => void
}) {
  const test = useXrayTest()
  const probe = useRealityProbe()
  const [probes, setProbes] = useState<Record<string, RealityProbeResult>>({})
  const [busyTag, setBusyTag] = useState<string | null>(null)

  // Проверка ядром локальная и дешёвая — запускаем сразу. Пробы Reality-целей
  // открывают исходящие соединения, поэтому только по кнопке.
  useEffect(() => {
    if (!open) return
    setProbes({})
    test.mutate(config)
    // config пересобирается на каждый рендер редактора — перезапускать проверку не нужно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} title="Проверка конфига" onClose={onClose}>
      <section className="check-section">
        <h3>Ядро Xray</h3>
        <CoreReport
          result={test.data}
          pending={test.isPending}
          error={test.error as Error | undefined}
          onOpenGeo={onOpenGeo}
        />
      </section>

      <section className="check-section">
        <h3>Reality-цели</h3>
        {targets.length === 0 ? (
          <p className="muted">Reality не используется ни в одном inbound&#39;е — проверять нечего.</p>
        ) : (
          <ul className="check-targets">
            {targets.map((target) => (
              <TargetRow
                key={target.inboundTag}
                target={target}
                result={probes[target.inboundTag]}
                busy={busyTag === target.inboundTag && probe.isPending}
                onProbe={() => {
                  setBusyTag(target.inboundTag)
                  probe.mutate(
                    { target: target.target, serverNames: target.serverNames },
                    {
                      onSuccess: (result) =>
                        setProbes((prev) => ({ ...prev, [target.inboundTag]: result })),
                      onSettled: () => setBusyTag(null),
                    },
                  )
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="row">
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Dialog>
  )
}

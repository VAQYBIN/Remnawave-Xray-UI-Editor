import type { MatchState, RuleVerdict, TraceResult } from '../../entities/xray'
import { Button } from '../../shared/ui'

const STATE_LABEL: Record<MatchState, string> = {
  yes: 'совпало',
  no: 'не совпало',
  unknown: 'нет данных',
}

const FIELD_LABEL: Record<string, string> = {
  domain: 'домен',
  ip: 'IP',
  port: 'порт',
  sourcePort: 'порт источника',
  network: 'сеть',
  source: 'источник',
  protocol: 'протокол',
  user: 'пользователь',
  inboundTag: 'inbound',
}

function VerdictRows({
  verdicts,
  winnerIndex,
  onSelectRule,
}: {
  verdicts: RuleVerdict[]
  winnerIndex: number | null | undefined
  onSelectRule: (index: number) => void
}) {
  return (
    <ul className="trace-rules" aria-label="Правила">
      {verdicts.map((v) => (
        <li
          key={v.index}
          className="trace-rule"
          data-state={v.state}
          data-winner={v.index === winnerIndex || undefined}
        >
          <button type="button" className="trace-rule-head" onClick={() => onSelectRule(v.index)}>
            <span className="trace-rule-no">{`#${v.index + 1}`}</span>
            <span className={`trace-badge trace-badge-${v.state}`}>{STATE_LABEL[v.state]}</span>
            {v.outboundTag && <span className="metric metric-accent">{v.outboundTag}</span>}
            {v.balancerTag && <span className="metric">{`балансер ${v.balancerTag}`}</span>}
          </button>
          {v.fields.length > 0 && (
            <div className="trace-fields">
              {v.fields.map((f, i) => (
                <span key={i} className="trace-field" data-state={f.state}>
                  <span className="trace-field-name">{FIELD_LABEL[f.field] ?? f.field}</span>
                  {f.reason}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function TracePanel({
  result,
  onClose,
  onSelectRule,
  onOpenGeo,
}: {
  result: TraceResult
  onClose: () => void
  onSelectRule: (index: number) => void
  onOpenGeo?: () => void
}) {
  const { winner } = result
  const shown = result.ipVerdicts ?? result.verdicts

  return (
    <aside className="trace-panel">
      <div className="trace-panel-head">
        <h2>Разбор трассы</h2>
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      </div>

      <div className="trace-winner" aria-label="Итог трассировки">
        {winner === undefined ? (
          <span className="field-error">Выходов нет — трафику некуда идти</span>
        ) : winner.ruleIndex === null ? (
          <>
            <span className="muted">
              {winner.injected
                ? 'Ни одно правило не совпало — трафик уйдёт в первый выход, а его подставит панель'
                : 'Ни одно правило не совпало — трафик уходит в первый выход'}
            </span>
            {winner.outboundTag && (
              <span className="metric metric-accent">{winner.outboundTag}</span>
            )}
            {winner.injected && <span className="metric metric-predicted">{winner.injected.selector}</span>}
          </>
        ) : (
          <>
            <span>{`Победило правило #${winner.ruleIndex + 1} →`}</span>
            {winner.outboundTag && <span className="metric metric-accent">{winner.outboundTag}</span>}
            {winner.injected && (
              <span className="metric metric-predicted" title="Выход подставит панель — в документе его нет">
                подстановка: {winner.injected.selector}
              </span>
            )}
            {winner.balancerTag && (
              <span className="metric">
                {`балансер ${winner.balancerTag} · ${winner.balancerStrategy ?? 'random'}`}
              </span>
            )}
            {winner.balancerCandidates?.map((tag) => (
              <span
                key={tag}
                className={
                  winner.injectedTags?.includes(tag)
                    ? 'metric metric-predicted'
                    : 'metric metric-accent'
                }
                title={winner.injectedTags?.includes(tag) ? 'Тег предсказан по префиксу' : undefined}
              >
                {tag}
              </span>
            ))}
          </>
        )}
      </div>

      {result.caveats.length > 0 && (
        <ul className="trace-caveats">
          {result.caveats.map((text, i) => (
            <li key={i} className="field-warning">
              {text}
              {/* Сообщение о незагруженных базах без пути к решению — тупик */}
              {onOpenGeo && text.includes('Geo-базы не загружены') && (
                <Button variant="ghost" onClick={onOpenGeo}>
                  Geo-базы
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {result.ipVerdicts && (
        <p className="muted trace-pass-note">
          Показан второй проход — по разрешённому адресу (стратегия IPIfNonMatch).
        </p>
      )}

      <VerdictRows verdicts={shown} winnerIndex={winner?.ruleIndex} onSelectRule={onSelectRule} />
    </aside>
  )
}

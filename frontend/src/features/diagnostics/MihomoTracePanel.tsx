// Разбор трассы шаблона Mihomo. Сестра `TracePanel` (Xray) и намеренно не одна с
// ней компонента: у Mihomo нет полей правила — есть строка, а вместо второго
// прохода по адресу есть ОСТАНОВКА, которой у Xray не бывает. Общая обёртка
// свелась бы к двум ветками почти на каждый блок.

import type { MihomoTraceResult } from '../../entities/mihomo/trace'
import type { MatchState } from '../../entities/xray'
import { Button } from '../../shared/ui'

const STATE_LABEL: Record<MatchState, string> = {
  yes: 'совпало',
  no: 'не совпало',
  unknown: 'проверить нечем',
}

export function MihomoTracePanel({
  result,
  onClose,
  onSelectRule,
  onOpenGeo,
}: {
  result: MihomoTraceResult
  onClose: () => void
  onSelectRule: (index: number) => void
  onOpenGeo?: () => void
}) {
  const { winner, stopped } = result

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
        {stopped !== undefined ? (
          // Ответа нет и придумывать его нельзя: правило выше могло совпасть, и
          // тогда всё, что ниже, не выполняется вовсе
          <span className="field-warning">
            {`Проход остановлен на правиле #${stopped.index + 1}: ${stopped.reason}. Куда уйдёт трафик, редактор сказать не может.`}
          </span>
        ) : winner === undefined ? (
          <span className="muted">Правил в документе нет — трассировать нечего</span>
        ) : winner.ruleIndex === null ? (
          <>
            <span className="muted">Ни одно правило не совпало — трафик уходит напрямую</span>
            <span className="metric metric-accent">{winner.target}</span>
          </>
        ) : (
          <>
            <span>{`Победило правило #${winner.ruleIndex + 1} →`}</span>
            <span className="metric metric-accent">{winner.target}</span>
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

      <ul className="trace-rules" aria-label="Правила">
        {result.verdicts.map((v) => (
          <li
            key={v.index}
            className="trace-rule"
            data-state={v.state}
            data-winner={v.index === winner?.ruleIndex || undefined}
          >
            <button type="button" className="trace-rule-head" onClick={() => onSelectRule(v.index)}>
              <span className="trace-rule-no">{`#${v.index + 1}`}</span>
              <span className={`trace-badge trace-badge-${v.state}`}>{STATE_LABEL[v.state]}</span>
              {v.target && <span className="metric metric-accent">{v.target}</span>}
            </button>
            {v.reason && (
              <div className="trace-fields">
                <span className="trace-field" data-state={v.state}>
                  {v.reason}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Список обрывается там, где оборвался проход: правила ниже не выполняются,
          и показывать их без вердикта — обещать разбор, которого не было */}
      <p className="muted trace-pass-note">
        Показаны правила, до которых дошёл проход: ниже победившего или остановившего правила
        список не выполняется.
      </p>
    </aside>
  )
}

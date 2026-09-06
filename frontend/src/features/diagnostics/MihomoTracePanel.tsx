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

/**
 * Итог трассы. Состояний ровно три, и это ВЕСЬ их список: остановка прохода,
 * дефолтный маршрут (`ruleIndex === null`) и победившее правило.
 *
 * Четвёртого — «правил в документе нет» — не бывает: `traceMihomo` оставляет
 * `winner` пустым РОВНО при остановке, а во всех остальных случаях, включая
 * документ вовсе без правил, ставит дефолтный `DIRECT`. Такая ветка здесь
 * стояла и была недостижима: мёртвый текст, читавшийся как поддержанный
 * сценарий (находка ревью). Осталась только проверка ради сужения типа —
 * связь `winner`/`stopped` типом не выражена, — и она ничего не обещает.
 */
function Verdict({ winner, stopped }: Pick<MihomoTraceResult, 'winner' | 'stopped'>) {
  // Ответа нет и придумывать его нельзя: правило выше могло совпасть, и тогда
  // всё, что ниже, не выполняется вовсе
  if (stopped !== undefined) {
    return (
      <span className="field-warning">
        {`Проход остановлен на правиле #${stopped.index + 1}: ${stopped.reason}. Куда уйдёт трафик, редактор сказать не может.`}
      </span>
    )
  }
  if (winner === undefined) return null
  if (winner.ruleIndex === null) {
    return (
      <>
        <span className="muted">Ни одно правило не совпало — трафик уходит напрямую</span>
        <span className="metric metric-accent">{winner.target}</span>
      </>
    )
  }
  return (
    <>
      <span>{`Победило правило #${winner.ruleIndex + 1} →`}</span>
      <span className="metric metric-accent">{winner.target}</span>
    </>
  )
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
  // Проход оборвался, только если он на чём-то остановился или кого-то выбрал:
  // дефолтный маршрут (ruleIndex === null) значит, что список пройден целиком
  const truncated = stopped !== undefined || typeof winner?.ruleIndex === 'number'

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
        <Verdict winner={winner} stopped={stopped} />
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

      {/* Сноска об усечении — только когда усечение было. Пройденный до конца
          список и документ без правил ничего не скрывают, и сообщать им не о чем */}
      {truncated && (
        <p className="muted trace-pass-note">
          {stopped !== undefined
            ? 'Показаны правила, до которых дошёл проход: ниже остановившего правила список не выполняется.'
            : 'Показаны правила, до которых дошёл проход: ниже победившего правила список не выполняется.'}
        </p>
      )}
    </aside>
  )
}

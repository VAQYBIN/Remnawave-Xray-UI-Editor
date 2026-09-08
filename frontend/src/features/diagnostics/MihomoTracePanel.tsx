// Разбор трассы шаблона Mihomo. Сестра `TracePanel` (Xray) и намеренно не одна с
// ней компонента: у Mihomo нет полей правила — есть строка, а вместо второго
// прохода по адресу есть ОСТАНОВКА, которой у Xray не бывает. Общая обёртка
// свелась бы к двум ветками почти на каждый блок.

import type { MihomoTraceOutcome, MihomoTraceResult } from '../../entities/mihomo/trace'
import type { MatchState } from '../../entities/xray'
import { Button } from '../../shared/ui'
import { groupDigits } from '../../shared/lib/format'

const STATE_LABEL: Record<MatchState, string> = {
  yes: 'совпало',
  no: 'не совпало',
  unknown: 'проверить нечем',
}

/**
 * Итог трассы. Состояний ровно три, и это ВЕСЬ их список: остановка прохода,
 * дефолтный маршрут (`ruleIndex === null`) и победившее правило.
 *
 * Четвёртого — «правил в документе нет» — не бывает: победитель пуст РОВНО при
 * остановке, а во всех остальных случаях, включая документ вовсе без правил,
 * стоит дефолтный `DIRECT`. Раньше это было соглашением, и здесь стояла мёртвая
 * защитная ветка, читавшаяся как поддержанный сценарий (находка ревью). Теперь
 * это `MihomoTraceOutcome`: после проверки остановки победитель определён по
 * типу, и защищаться не от чего.
 */
function Verdict({ outcome }: { outcome: MihomoTraceOutcome }) {
  if (outcome.stopped !== undefined) {
    return (
      <span className="field-warning">
        {`Проход остановлен на правиле #${outcome.stopped.index + 1}: ${outcome.stopped.reason}. Куда уйдёт трафик, редактор сказать не может.`}
      </span>
    )
  }
  // Ответа нет и придумывать его нельзя: правило выше могло совпасть, и тогда
  // всё, что ниже, не выполняется вовсе
  const { winner } = outcome
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
  // Разбирать `result` на переменные нельзя: связь победителя с остановкой живёт
  // в типе результата, и деструктуризация её теряет
  // Проход оборвался, только если он на чём-то остановился или кого-то выбрал:
  // дефолтный маршрут (ruleIndex === null) значит, что список пройден целиком
  const truncated = result.stopped !== undefined || typeof result.winner?.ruleIndex === 'number'

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
        <Verdict outcome={result} />
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
            data-winner={v.index === result.winner?.ruleIndex || undefined}
          >
            <button type="button" className="trace-rule-head" onClick={() => onSelectRule(v.index)}>
              <span className="trace-rule-no">{`#${v.index + 1}`}</span>
              <span className={`trace-badge trace-badge-${v.state}`}>{STATE_LABEL[v.state]}</span>
              {v.target && <span className="metric metric-accent">{v.target}</span>}
            </button>
            {(v.reason || v.sets) && (
              <div className="trace-fields">
                {v.reason && (
                  <span className="trace-field" data-state={v.state}>
                    {v.reason}
                  </span>
                )}
                {v.sets?.map((set) => (
                  // «Не совпало» по набору из ста тысяч доменов и «не совпало»
                  // по пустому выглядят одинаково, а значат разное
                  <span key={set.name} className="trace-set">
                    {`набор «${set.name}» — записей: ${groupDigits(set.count)}`}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Сноска об усечении — только когда усечение было. Пройденный до конца
          список и документ без правил ничего не скрывают, и сообщать им не о чем */}
      {truncated && (
        <p className="muted trace-pass-note">
          {result.stopped !== undefined
            ? 'Показаны правила, до которых дошёл проход: ниже остановившего правила список не выполняется.'
            : 'Показаны правила, до которых дошёл проход: ниже победившего правила список не выполняется.'}
        </p>
      )}
    </aside>
  )
}

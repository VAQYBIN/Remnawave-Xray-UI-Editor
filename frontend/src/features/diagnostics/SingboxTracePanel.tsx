// Разбор трассы шаблона sing-box. Сестра `MihomoTracePanel` и `TracePanel`
// (Xray), а не общая с ними компонента: у sing-box правило — набор условий, а
// не строка и не поля Xray, и остановка бывает ВНЕ списка правил, чего у обоих
// соседей не бывает вовсе. Общая обёртка свелась бы к ветке на каждый блок.

import type { SingboxTraceOutcome, SingboxTraceResult } from '../../entities/singbox/trace'
import type { MatchState } from '../../entities/xray'
import { Button } from '../../shared/ui'

const STATE_LABEL: Record<MatchState, string> = {
  yes: 'совпало',
  no: 'не совпало',
  unknown: 'проверить нечем',
}

/**
 * Итог трассы. Разбирать `result` на переменные нельзя: связь победителя с
 * остановкой живёт в типе результата (`SingboxTraceOutcome`), и деструктуризация
 * её теряет — вместе с ней вернулось бы право вывести победителя, не спросив об
 * остановке.
 */
function Verdict({ outcome }: { outcome: SingboxTraceOutcome }) {
  if (outcome.stopped !== undefined) {
    // Остановка вне списка бывает двух видов — до правил (цель не задана) и
    // после них (маршрут по умолчанию из документа не выводится), — и различить
    // их по результату нечем: документ без правил даёт пустой список вердиктов
    // в обоих случаях. Поэтому место названо нейтрально, а какой это случай,
    // говорит причина: сказать «разбор не начался» о пройденном до конца списке
    // значило бы соврать.
    const where =
      outcome.stopped.index === null
        ? 'Разбор оборвался вне списка правил'
        : `Проход остановлен на правиле #${outcome.stopped.index + 1}`
    return (
      <span className="field-warning">
        {`${where}: ${outcome.stopped.reason}. Куда уйдёт трафик, редактор сказать не может.`}
      </span>
    )
  }
  // Ответа нет и придумывать его нельзя: правило выше могло совпасть, и тогда
  // всё, что ниже, не выполняется вовсе
  const { winner } = outcome
  if (winner.ruleIndex === null) {
    return (
      <>
        <span className="muted">Ни одно правило не совпало — трафик уходит в выход</span>
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

export function SingboxTracePanel({
  result,
  onClose,
  onSelectRule,
}: {
  result: SingboxTraceResult
  onClose: () => void
  onSelectRule: (index: number) => void
}) {
  // Список оборван, только если проход встал НА правиле или выбрал победителя.
  // Остановка вне списка ничего не скрывает: до правил разбор не дошёл, а после
  // них прятать уже нечего — как и у дефолтного маршрута
  const truncated =
    typeof result.stopped?.index === 'number' || typeof result.winner?.ruleIndex === 'number'

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
          {result.stopped !== undefined
            ? 'Показаны правила, до которых дошёл проход: ниже остановившего правила список не выполняется.'
            : 'Показаны правила, до которых дошёл проход: ниже победившего правила список не выполняется.'}
        </p>
      )}
    </aside>
  )
}

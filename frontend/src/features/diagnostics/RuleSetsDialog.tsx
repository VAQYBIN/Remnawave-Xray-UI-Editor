// Состояние наборов правил документа. Сестра `GeoDataDialog`: тот же вопрос
// («что у редактора есть на руках и насколько оно свежее»), заданный про другой
// источник данных.
import type { RuleSetDescriptor } from '../../entities/mihomo/ruleSets'
import {
  useRefreshRuleSets,
  useRuleSetStatus,
  type RuleSetQuery,
  type RuleSetStatusItem,
} from '../../shared/api'
import { formatBytes, groupDigits } from '../../shared/lib/format'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog } from '../../shared/ui'

/**
 * Причина, известная без сети. Такие наборы показываются наравне с остальными:
 * спрятать строку — значит соврать, что набора нет в документе.
 */
function localReason(set: RuleSetDescriptor): string | null {
  if (set.kind === 'file') return 'лежит в файле у клиента — сервер такой файл не видит'
  if (set.kind === 'unsupported') return set.reason
  return null
}

function stateText(item: RuleSetStatusItem | undefined): string {
  if (item === undefined) return 'состояние ещё не пришло'
  if (item.state === 'missing') return 'ещё не загружен'
  if (item.state === 'error') return item.reason ?? 'не читается'
  const when =
    item.loadedAt === undefined
      ? ''
      : ` ${relativeTime(new Date(item.loadedAt).toISOString())}`
  // Просрочка — не поломка: файл на месте, но следующая трассировка перекачает его
  return item.stale ? `загружен${when}, срок вышел` : `загружен${when}`
}

export function RuleSetsDialog({
  open,
  onClose,
  sets,
  asked,
}: {
  open: boolean
  onClose: () => void
  /** Все наборы документа, включая те, что редактор достать не может */
  sets: RuleSetDescriptor[]
  /** Из них — те, о которых можно спросить сервер */
  asked: RuleSetQuery[]
}) {
  // Спрашиваем только на открытом диалоге: закрытый <dialog> всё равно
  // рендерит содержимое, и без этого условия состояние тянулось бы всегда
  const status = useRuleSetStatus(asked, open)
  const refresh = useRefreshRuleSets()
  const byName = new Map((status.data ?? []).map((item) => [item.name, item]))

  return (
    <Dialog open={open} title="Наборы правил" onClose={onClose}>
      {open && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Наборы нужны трассировщику, чтобы отвечать по условиям{' '}
            <span className="mono">RULE-SET</span>. Редактор качает их напрямую и держит копию у
            себя; клиент качает их сам и может получить другое содержимое.
          </p>

          {sets.length === 0 ? (
            <p className="muted">В документе нет наборов правил: секция rule-providers пуста.</p>
          ) : (
            <>
              <div className="row">
                <span className="muted">{`наборов: ${sets.length}`}</span>
                <span className="spacer" />
                <Button
                  disabled={asked.length === 0 || refresh.isPending}
                  onClick={() => refresh.mutate({ sets: asked })}
                >
                  {refresh.isPending ? 'Обновляю…' : 'Обновить все'}
                </Button>
              </div>

              {status.isError && (
                <p className="field-error">{(status.error as Error).message}</p>
              )}
              {refresh.isError && (
                <p className="field-error">{(refresh.error as Error).message}</p>
              )}

              <ul className="rs-list" aria-label="Наборы правил">
                {sets.map((set) => {
                  const reason = localReason(set)
                  const item = byName.get(set.name)
                  return (
                    <li key={set.name} className="rs-row" data-state={reason ? 'local' : item?.state}>
                      <span className="rs-name mono">{set.name}</span>
                      <span className="rs-tags">
                        {'behavior' in set ? `${set.behavior} · ${set.format}` : '—'}
                      </span>
                      <span className={reason || item?.state === 'error' ? 'field-warning' : 'muted'}>
                        {reason ?? stateText(item)}
                      </span>
                      <span className="rs-metrics">
                        {item?.count !== undefined && (
                          <span className="metric metric-accent">{groupDigits(item.count)}</span>
                        )}
                        {item?.bytes !== undefined && (
                          <span className="metric">{formatBytes(item.bytes)}</span>
                        )}
                      </span>
                      {reason === null && (
                        <Button
                          variant="ghost"
                          aria-label={`Обновить набор ${set.name}`}
                          disabled={refresh.isPending}
                          onClick={() => refresh.mutate({ sets: asked, names: [set.name] })}
                        >
                          Обновить
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
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

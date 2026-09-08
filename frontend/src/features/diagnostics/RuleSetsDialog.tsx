// Состояние наборов правил документа. Сестра `GeoDataDialog`: тот же вопрос
// («что у редактора есть на руках и насколько оно свежее»), заданный про другой
// источник данных.
import { useState } from 'react'
import { FILE_SET_REASON, type RuleSetDescriptor } from '../../entities/mihomo/ruleSets'
import {
  useRefreshRuleSets,
  useRuleSetStatus,
  type RuleSetQuery,
  type RuleSetStatusItem,
} from '../../shared/api'
import { formatBytes, groupDigits } from '../../shared/lib/format'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Dialog } from '../../shared/ui'
import { RuleSetBrowser } from './RuleSetBrowser'

/**
 * Причина, известная без сети. Такие наборы показываются наравне с остальными:
 * спрятать строку — значит соврать, что набора нет в документе.
 */
function localReason(set: RuleSetDescriptor): string | null {
  if (set.kind === 'file') return FILE_SET_REASON
  if (set.kind === 'unsupported') return set.reason
  return null
}

/**
 * `failed` — запрос состояния отказал. Ответа по этому набору не будет вовсе
 * (у хука `retry: false`), и «состояние ещё не пришло» было бы обещанием, а не
 * правдой: причина стоит красной строкой выше, и строка набора не должна ей
 * противоречить. Тот же класс ошибки уже чинили в просмотрщике, где отказ
 * загрузки выглядел как «набор пуст».
 */
function stateText(item: RuleSetStatusItem | undefined, failed: boolean): string {
  if (item === undefined) return failed ? 'состояние не получено' : 'состояние ещё не пришло'
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
  // Список строк и просмотрщик содержимого взаимоисключающие: отдельной
  // вкладки не заводим, «К списку» — единственный обратный ход
  const [viewing, setViewing] = useState<RuleSetQuery | null>(null)

  return (
    <Dialog open={open} title="Наборы правил" onClose={onClose} wide={viewing !== null}>
      {open && viewing !== null && (
        <RuleSetBrowser descriptor={viewing} onBack={() => setViewing(null)} />
      )}
      {open && viewing === null && (
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
                      {reason === null ? (
                        <button
                          type="button"
                          className="rs-name rs-open mono"
                          onClick={() => setViewing(asked.find((a) => a.name === set.name) ?? null)}
                        >
                          {set.name}
                        </button>
                      ) : (
                        <span className="rs-name mono">{set.name}</span>
                      )}
                      <span className="rs-tags">
                        {'behavior' in set ? `${set.behavior} · ${set.format}` : '—'}
                      </span>
                      <span
                        className={
                          reason || item?.state === 'error' || (item === undefined && status.isError)
                            ? 'field-warning'
                            : 'muted'
                        }
                      >
                        {reason ?? stateText(item, status.isError)}
                      </span>
                      <span className="rs-metrics">
                        {item?.count !== undefined && (
                          <span className="metric metric-accent">{groupDigits(item.count)}</span>
                        )}
                        {item?.bytes !== undefined && (
                          <span className="metric">{formatBytes(item.bytes)}</span>
                        )}
                      </span>
                      {/* Кнопка только у сетевых наборов: содержимое встроенного
                          лежит в самом документе, и `refresh` на бэкенде такие
                          наборы отфильтровывает — кнопка помигала бы «Обновляю…»
                          и вернула бы ровно то же состояние */}
                      {set.kind === 'http' && (
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

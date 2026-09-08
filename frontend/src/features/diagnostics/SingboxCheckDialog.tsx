// Отчёт проверки шаблона sing-box ядром. Сестра MihomoCheckDialog, но источник
// тела запроса другой: у sing-box содержимое шаблона — уже объект (`templateJson`),
// а не текст в другой нотации, поэтому черновик сначала разбирается как JSON
// здесь же, во фронтенде, а не отправляется строкой.
//
// Три состояния ответа обязаны читаться по-разному, и это главное требование:
//   available: false — инструмента нет, о шаблоне не сказано ничего;
//   ok: true         — ядро приняло СТРУКТУРУ на фиктивных серверах;
//   ok: false        — ядро отклонило, список строк как есть.
// Четвёртое состояние — черновик не разбирается как JSON: объясняем ДО запроса,
// не тревожа сервер, — кнопку жмут именно тогда, когда с документом что-то не так.

import { useEffect, useState } from 'react'
import { useSingboxTest, type SingboxTestResult } from '../../shared/api'
import { Button, Dialog } from '../../shared/ui'

function CoreReport({
  result,
  pending,
  error,
  localError,
}: {
  result: SingboxTestResult | undefined
  pending: boolean
  error: Error | undefined
  localError: string | null
}) {
  if (localError) return <p className="field-error">{localError}</p>
  if (pending) return <p className="muted">Проверяю шаблон ядром sing-box…</p>
  if (error) return <p className="field-error">{error.message}</p>
  if (!result) return null

  if (!result.available) {
    return (
      <p className="field-warning">
        Проверка ядром недоступна: бинарь sing-box не найден. Путь к нему задаёт переменная{' '}
        <span className="mono">SINGBOX_BIN</span> — о самом шаблоне это не говорит ничего.
      </p>
    )
  }

  // Оговорка идёт при ОБОИХ вердиктах, а не только при успехе, и в отказе она
  // нужнее: бэкенд (`backend/src/singbox/dummyOutbounds.ts`) дописывает фиктивные
  // серверы В КОНЕЦ `outbounds`, перезаписывает списки выходов у групп и вырезает
  // ключ `remnawave` — ядро строго к незнакомым полям. Значит отказ может назвать
  // тег или позицию, которых в файле пользователя нет, — и без оговорки он пойдёт
  // искать у себя то, чего не писал. При отсутствующем бинаре оговорки нет: ядро
  // не запускалось, подменять было нечего.
  return (
    <>
      {result.ok ? (
        <p className="check-verdict-ok">Ядро приняло шаблон</p>
      ) : (
        <>
          <p className="field-error">Ядро отклонило шаблон</p>
          <ul className="check-list" aria-label="Ошибки ядра">
            {result.errors.map((message, i) => (
              <li key={i} className="check-item check-level-error">
                <span className="mono">{message}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted check-note">
        Ядро смотрело не ваш документ дословно: в конец списка выходов дописаны фиктивные
        серверы (настоящие подставляет панель), их теги подставлены в списки групп, а ключ
        remnawave вырезан — ядро строго к незнакомым полям. Поэтому оно может назвать тег или
        позицию, которых в вашем шаблоне нет, а успех говорит о структуре, но не о
        работоспособности конкретных серверов.
      </p>
    </>
  )
}

export function SingboxCheckDialog({
  open,
  /** Текст черновика: источник истины — он, а не модель документа */
  text,
  onClose,
}: {
  open: boolean
  text: string
  onClose: () => void
}) {
  const test = useSingboxTest()
  const [localError, setLocalError] = useState<string | null>(null)

  // Диалог смонтирован вместе со страницей, а проверка запускает процесс на
  // сервере — запускаем ровно на открытие, а не на монтирование.
  useEffect(() => {
    if (!open) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setLocalError(`Черновик не разбирается как JSON: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    setLocalError(null)
    test.mutate({ templateJson: parsed })
    // text меняется на каждое нажатие клавиши в редакторе — перезапускать
    // проверку на нём нельзя, снимок берётся на момент открытия
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} title="Проверка ядром sing-box" onClose={onClose}>
      <section className="check-section">
        <h3>Ядро sing-box</h3>
        <CoreReport
          result={test.data}
          pending={test.isPending}
          error={test.error as Error | undefined}
          localError={localError}
        />
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

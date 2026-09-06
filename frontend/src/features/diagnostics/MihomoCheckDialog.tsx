// Отчёт проверки шаблона Mihomo ядром. Сестра CheckReportDialog (Xray), но
// секция здесь одна: Reality-целей у клиентской подписки нет, а сама подписка
// проверяется не на работоспособность, а на разбираемость документа.
//
// Три состояния ответа обязаны читаться по-разному, и это главное требование:
//   available: false — инструмента нет, о шаблоне не сказано ничего;
//   ok: true         — ядро приняло СТРУКТУРУ на фиктивных серверах;
//   ok: false        — ядро отклонило, список строк как есть.
// Четвёртое состояние приходит обычной ошибкой мутации: на неразбираемом YAML
// бэкенд отвечает 400 с русским текстом — его и показываем.

import { useEffect } from 'react'
import { useMihomoTest, type MihomoTestResult } from '../../shared/api'
import { encodeYaml } from '../../shared/lib/base64'
import { Button, Dialog } from '../../shared/ui'

function CoreReport({
  result,
  pending,
  error,
}: {
  result: MihomoTestResult | undefined
  pending: boolean
  error: Error | undefined
}) {
  if (pending) return <p className="muted">Проверяю шаблон ядром mihomo…</p>
  if (error) return <p className="field-error">{error.message}</p>
  if (!result) return null

  if (!result.available) {
    return (
      <p className="field-warning">
        Проверка ядром недоступна: бинарь mihomo не найден. Путь к нему задаёт переменная{' '}
        <span className="mono">MIHOMO_BIN</span> — о самом шаблоне это не говорит ничего.
      </p>
    )
  }

  // Оговорка идёт при ОБОИХ вердиктах, а не только при успехе, и в отказе она
  // нужнее: бэкенд подменяет `proxies` фиктивными `mihomo-dummy-*`, дописывает
  // эти имена в группы и вырезает секции `remnawave`, а строки ядра отдаются
  // как есть. Значит отказ может назвать имя или позицию, которых в файле
  // пользователя нет, — и без оговорки он пойдёт искать у себя то, чего не
  // писал. При отсутствующем бинаре оговорки нет: ядро не запускалось.
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
        Ядро смотрело не ваш документ дословно: вместо серверов подставлены фиктивные прокси
        (настоящие хосты подписке подставляет панель), их имена дописаны в группы, а секции
        remnawave вырезаны. Поэтому ядро может назвать имя или позицию, которых в вашем шаблоне
        нет, а успех говорит о структуре, но не о работоспособности конкретных серверов.
      </p>
    </>
  )
}

export function MihomoCheckDialog({
  open,
  /** Текст черновика: источник истины — он, а не модель документа */
  text,
  onClose,
}: {
  open: boolean
  text: string
  onClose: () => void
}) {
  const test = useMihomoTest()

  // Диалог смонтирован вместе со страницей, а проверка запускает процесс на
  // сервере — запускаем ровно на открытие, а не на монтирование.
  useEffect(() => {
    if (!open) return
    test.mutate({ encodedTemplateYaml: encodeYaml(text) })
    // text меняется на каждое нажатие клавиши в редакторе — перезапускать
    // проверку на нём нельзя, снимок берётся на момент открытия
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} title="Проверка ядром mihomo" onClose={onClose}>
      <section className="check-section">
        <h3>Ядро mihomo</h3>
        <CoreReport
          result={test.data}
          pending={test.isPending}
          error={test.error as Error | undefined}
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

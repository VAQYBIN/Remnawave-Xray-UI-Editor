import type { PanelTokenStatus } from '../../shared/api/types'

/**
 * Токен панели выдаётся на 30 дней, и панель никак не напоминает об истечении:
 * в день X она просто начинает отвечать 401 на всё. Бэкенд предупреждает об
 * этом в логах, но оператор смотрит не в логи, а сюда.
 */
export function PanelTokenNotice({ status }: { status?: PanelTokenStatus }) {
  if (status === undefined || !status.expiringSoon || status.daysLeft === null) return null

  const title =
    status.expiresAt === null
      ? undefined
      : `Срок действия REMNAWAVE_TOKEN: ${new Date(status.expiresAt).toLocaleDateString('ru-RU')}`

  return (
    <span
      role="status"
      className={status.expired ? 'field-error' : 'field-warning'}
      title={title}
    >
      {status.expired
        ? 'API-токен панели истёк — выпустите новый и обновите REMNAWAVE_TOKEN'
        : `API-токен панели истекает ${humanizeDays(status.daysLeft)}`}
    </span>
  )
}

function humanizeDays(days: number): string {
  if (days <= 0) return 'сегодня'
  return `через ${days} ${pluralizeDays(days)}`
}

/** 1 день, 2–4 дня, 5–20 дней; десятки и сотни считаются по последним цифрам. */
function pluralizeDays(days: number): string {
  const tail = days % 100
  if (tail >= 11 && tail <= 14) return 'дней'
  switch (days % 10) {
    case 1:
      return 'день'
    case 2:
    case 3:
    case 4:
      return 'дня'
    default:
      return 'дней'
  }
}

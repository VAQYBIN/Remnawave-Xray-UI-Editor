/**
 * Панель выдаёт API-токен на 30 дней и никак не напоминает об истечении: в день
 * X она просто начинает отвечать 401 на всё. Редактор об этом скажет по-русски
 * (см. PANEL_TOKEN_HINT), но уже постфактум — а предупредить лучше заранее.
 *
 * Срок лежит в claim `exp` самого токена, читать панель для этого не нужно.
 * Подпись мы не проверяем и не можем: секрет HS256 знает только панель. Нам и
 * незачем — токен пришёл из нашего же `.env`, вопрос стоит не «подлинный ли он»,
 * а «когда протухнет». Испорченный `exp` поэтому не ошибка конфигурации, а
 * просто «срок неизвестен».
 */

/** За сколько дней до истечения начинаем предупреждать. */
export const EXPIRY_WARN_DAYS = 7

export interface TokenStatus {
  /** ISO-время истечения; null — срок прочитать не удалось */
  expiresAt: string | null
  /** Целых суток до истечения; отрицательное — просрочен; null — срок неизвестен */
  daysLeft: number | null
  expired: boolean
  /** Пора выпускать новый: истёк или до истечения меньше EXPIRY_WARN_DAYS */
  expiringSoon: boolean
}

const UNKNOWN: TokenStatus = {
  expiresAt: null,
  daysLeft: null,
  expired: false,
  expiringSoon: false,
}

/** `exp` в JWT — секунды с эпохи (RFC 7519), а не миллисекунды. */
function readExpSeconds(token: string): number | undefined {
  const payload = token.split('.')[1]
  if (payload === undefined || payload === '') return undefined
  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return undefined
  const exp = (claims as { exp?: unknown }).exp
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined
}

export function describeToken(token: string, now: Date = new Date()): TokenStatus {
  const exp = readExpSeconds(token)
  if (exp === undefined) return UNKNOWN

  const expiresAt = new Date(exp * 1000)
  // Округляем вниз: «остался 1 день» честнее, чем «2», когда до конца 25 часов.
  const daysLeft = Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000)
  const expired = expiresAt.getTime() <= now.getTime()
  return {
    expiresAt: expiresAt.toISOString(),
    daysLeft,
    expired,
    expiringSoon: expired || daysLeft <= EXPIRY_WARN_DAYS,
  }
}

/** Строка для лога на старте; undefined — предупреждать не о чем. */
export function describeTokenWarning(status: TokenStatus): string | undefined {
  if (!status.expiringSoon) return undefined
  if (status.expired) {
    return `API-токен панели истёк ${status.expiresAt}. Панель будет отвечать 401 на все запросы — выпустите новый токен и обновите REMNAWAVE_TOKEN.`
  }
  return `API-токен панели истекает ${status.expiresAt} (осталось дней: ${status.daysLeft}). Выпустите новый токен заранее.`
}

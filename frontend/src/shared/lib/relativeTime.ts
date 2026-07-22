export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const sec = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (sec < 60) return 'только что'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} дн назад`
  return then.toLocaleDateString('ru-RU')
}

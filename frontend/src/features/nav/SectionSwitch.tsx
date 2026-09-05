// Два раздела панели, которые правит редактор: конфиг-профили нод и шаблоны
// подписок. Переключатель стоит в шапке обоих списков — иначе о втором разделе
// узнать неоткуда.

import { Link, useLocation } from 'react-router'

export function SectionSwitch() {
  const { pathname } = useLocation()
  const onTemplates = pathname.startsWith('/templates')
  return (
    <nav className="segmented" aria-label="Разделы">
      {/* Текущий раздел помечен только aria-current: aria-pressed — атрибут
          кнопки-переключателя, на роли link он невалиден и частью читалок
          игнорируется. Подсветку CSS берёт из того же aria-current. */}
      <Link className="btn" to="/" aria-current={onTemplates ? undefined : 'page'}>
        Профили
      </Link>
      <Link className="btn" to="/templates" aria-current={onTemplates ? 'page' : undefined}>
        Шаблоны
      </Link>
    </nav>
  )
}

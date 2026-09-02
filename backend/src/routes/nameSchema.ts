import { z } from 'zod'

// Регулярка зеркалит валидацию панели (проверено на живой 3.4.3: панель
// отвечает 400 "Name can only contain letters, numbers, underscores, dashes
// and spaces", pattern /^[A-Za-z0-9_\s-]+$/) — общая для имени профиля и
// имени шаблона подписки. Расширять нельзя: панель всё равно откажет,
// только позже и по-английски.
export const nameSchema = z
  .string()
  .min(2)
  .max(30)
  .regex(/^[A-Za-z0-9_\s-]+$/, 'Имя: латиница, цифры, пробел, - и _')

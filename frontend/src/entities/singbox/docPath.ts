// Где в словаре искать ключ, стоящий вот в этом месте документа.
//
// Словарь (`docSchema.ts`) плоский: десять секций, у каждой список ключей.
// Формам этого хватает — форма знает свою секцию. Подсказкам не хватает: они
// идут по дереву текста и обязаны сами понять, куда попал курсор. Отсюда этот
// слой — и он ОТДЕЛЬНЫЙ файл, а не поле в словаре: словарь описывает ключи, а
// здесь описан документ, и смешивать два описания значит менять оба ради одного.
//
// Приём взят у Xray (`entities/xray/docSchema.ts`, функция `descend`): спуск на
// один шаг, где следующая секция зависит не только от ключа, но и от уже
// прочитанных скаляров текущего объекта.

import { SINGBOX_SECTIONS, type SingboxField, type SingboxSectionName } from './docSchema'

/** Типы выходов, у которых своя секция словаря: список участников вместо адреса сервера */
const GROUP_TYPES = new Set(['selector', 'urltest'])

/**
 * Спуск на один шаг: из секции по ключу в следующую секцию.
 *
 * `props` — скаляры ТЕКУЩЕГО объекта, уже прочитанные из документа. Нужны ровно
 * одному переходу, зато принципиально: группа и сервер лежат в одном массиве
 * `outbounds` и отличаются только полем `type`. Без него подсказка предлагала бы
 * серверу `outbounds`, а группе — `server` и `password`.
 */
export function descendSingbox(
  section: SingboxSectionName | undefined,
  key: string,
  props: Record<string, string>,
): SingboxSectionName | undefined {
  if (section === undefined) return undefined
  if (section === 'root') {
    if (key === 'inbounds') return 'inbound'
    if (key === 'outbounds' || key === 'endpoints') {
      return GROUP_TYPES.has(props.type ?? '') ? 'group' : 'outbound'
    }
    if (key === 'route') return 'route'
    if (key === 'dns') return 'dns'
    if (key === 'experimental') return 'experimental'
    return undefined
  }
  if (section === 'route') {
    if (key === 'rules') return 'route-rule'
    if (key === 'rule_set') return 'rule-set'
    return undefined
  }
  // Логическое правило несёт вложенные правила с теми же условиями. Своя секция
  // для них была бы копией этой и разошлась бы с оригиналом на первом же поле
  if (section === 'route-rule' && key === 'rules') return 'route-rule'
  if (section === 'dns' && key === 'servers') return 'dns-server'
  if (section === 'dns' && key === 'rules') return 'route-rule'
  return undefined
}

/**
 * Секция для пути целиком. `typeAt` спрашивает у документа поле `type` объекта,
 * лежащего по пути, — читать документ сам этот модуль не умеет и не должен: у
 * подсказок дерево CodeMirror, у резолверов диагностик — разобранная модель, и
 * общий обход был бы третьим разбором того же документа.
 */
export function sectionAtPath(
  path: readonly (string | number)[],
  typeAt: (path: readonly (string | number)[]) => string | undefined,
): SingboxSectionName | undefined {
  let section: SingboxSectionName | undefined = 'root'
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i]
    // Индекс массива секцию не меняет: элемент списка — это тот же вид объекта,
    // что назвал ключ списка. Тип элемента спрашиваем ЗДЕСЬ, на индексе, потому
    // что у каждого элемента он свой
    if (typeof step === 'number') continue
    const at = path.slice(0, i + 2)
    const props: Record<string, string> = typeof path[i + 1] === 'number' ? { type: typeAt(at) ?? '' } : {}
    section = descendSingbox(section, step, props)
    if (section === undefined) return undefined
  }
  return section
}

/**
 * Листья вложенного отображения с КОРОТКИМИ ключами: внутри `remnawave` пишут
 * `includeProxies`, а не `remnawave.includeProxies`.
 */
export function nestedFields(section: SingboxSectionName, head: string): SingboxField[] {
  const prefix = `${head}.`
  return SINGBOX_SECTIONS[section]
    .filter((field) => field.key.startsWith(prefix))
    .map((field) => ({ ...field, key: field.key.slice(prefix.length) }))
}

/**
 * Описание самого вложенного отображения — ОДНИМ текстом на обоих потребителей,
 * подсказку при наборе и наведение на уже написанный ключ. Ровно та же ошибка,
 * что чинилась у Mihomo: пока текст жил внутри подсказок, редактор описывал ключ,
 * пока его печатают, и молчал, стоило его дописать.
 */
export function nestedNamespaceDoc(
  section: SingboxSectionName,
  head: string,
): string | undefined {
  const leaves = nestedFields(section, head)
  if (leaves.length === 0) return undefined
  return `Вложенное отображение ${head}: ${leaves.map((f) => f.key).join(', ')}`
}

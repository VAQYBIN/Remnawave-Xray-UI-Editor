// Инспектор выбранного узла шаблона Mihomo — третья сборка того же приёма, что
// у Xray (`NodeInspector`) и sing-box (`SingboxInspector`): разводка по
// префиксу id узла и та же оболочка `.wb-inspector`. Вкладки «JSON узла» здесь
// нет и быть не может: узел — это место в ТЕКСТЕ документа, а не самостоятельный
// объект, и печать его обратно уничтожила бы якоря с маркерами.
//
// Формы получают writer = draft.writer БЕЗ обёртки инспектора: и правка поля,
// и перестановка, и удаление уходят операциями DocOp прямо в applyMihomoOps
// (задача 10), который сам решает режим (сплайс/модель) и сам отказывает на
// пути через алиас/слияние. Имя записи пишется не операцией set, а
// переименованием (`draft.rename`) — оно одно переносит ссылки и держит выбор
// за узлом, когда имя меняется.

import { useMemo } from 'react'
import {
  groupsOf,
  groupTakesHosts,
  panelInjectsHosts,
  providersOf,
  proxiesOf,
  ruleEntriesOf,
  rulesOf,
  subRuleEntries,
  type MihomoDoc,
  type MihomoGroup,
} from '../../entities/mihomo'
import { mihomoRefs } from '../../entities/mihomo/schema'
import { valueAt, type DocOp, type SchemaPath } from '../../shared/schema'
import { Button } from '../../shared/ui'
import { MihomoDocPanel } from './MihomoDocPanel'
import { MihomoGroupForm } from '../inspector/MihomoGroupForm'
import { MihomoProviderForm } from '../inspector/MihomoProviderForm'
import { MihomoProxyForm } from '../inspector/MihomoProxyForm'
import { MihomoRuleForm } from '../inspector/MihomoRuleForm'
import { MihomoSubRuleForm } from '../inspector/MihomoSubRuleForm'
import type { MihomoDraft } from '../editor/useMihomoDraft'

type Kind = 'group' | 'rule' | 'proxy' | 'provider' | 'hosts' | 'subrule' | 'builtin' | 'settings' | 'other'

const KIND_LABEL: Record<Kind, string> = {
  group: 'группа',
  rule: 'правило',
  proxy: 'сервер',
  provider: 'провайдер',
  hosts: 'подстановка',
  subrule: 'подсписок',
  builtin: 'встроенная цель',
  settings: 'документ',
  other: 'узел',
}

/** Подпись кнопки удаления. У видов без записи в документе (hosts, builtin, settings, other) её нет вовсе */
const REMOVE_LABEL: Partial<Record<Kind, string>> = {
  group: 'Удалить группу',
  rule: 'Удалить правило',
  proxy: 'Удалить сервер',
  provider: 'Удалить провайдера',
  subrule: 'Удалить подсписок',
}

/** Что делает встроенная цель ядра. Карточка справочная: править тут нечего. */
const BUILTIN_DOC: Record<string, string> = {
  DIRECT: 'Соединение идёт напрямую, минуя прокси.',
  REJECT: 'Соединение отклоняется: клиент сразу получает отказ.',
  'REJECT-DROP': 'Пакеты отбрасываются молча, без ответа клиенту.',
  PASS: 'Правило пропускается — решение принимает следующее совпавшее правило.',
  COMPATIBLE: 'Служебная заглушка ядра: подставляется там, где группа осталась пустой.',
}

/**
 * Псевдоузлы: id, которого в графе нет вовсе. `doc:settings` открывает панель
 * «Документ» — единственный вход к разделам без узлов на холсте (`dns`, `tun`,
 * наборы правил, провайдеры и т.д., см. SETTINGS_KEYS в entities/graph/mihomo/locate.ts).
 */
const PSEUDO_NODES: Record<string, Kind> = {
  'doc:settings': 'settings',
}

function kindOf(nodeId: string): Kind {
  const pseudo = PSEUDO_NODES[nodeId]
  if (pseudo !== undefined) return pseudo
  const prefix = nodeId.slice(0, nodeId.indexOf(':'))
  return prefix === 'group' ||
    prefix === 'rule' ||
    prefix === 'proxy' ||
    prefix === 'provider' ||
    prefix === 'hosts' ||
    prefix === 'subrule' ||
    prefix === 'builtin'
    ? prefix
    : 'other'
}

/** Где в документе лежит запись выбранного узла — для порядка и удаления. Провайдер и подсписок сюда не входят: у отображений порядка нет, YAML его не обещает */
function recordSlot(md: MihomoDoc, kind: Kind, name: string): { list: SchemaPath; index: number; length: number } | null {
  if (kind === 'rule') {
    const rules = rulesOf(md)
    const index = Number(name)
    return rules.some((r) => r.index === index) ? { list: ['rules'], index, length: rules.length } : null
  }
  if (kind === 'group') {
    const groups = groupsOf(md)
    const g = groups.find((x) => x.name === name)
    return g ? { list: ['proxy-groups'], index: g.index, length: groups.length } : null
  }
  if (kind === 'proxy') {
    const proxies = proxiesOf(md)
    const p = proxies.find((x) => x.name === name)
    return p ? { list: ['proxies'], index: p.index, length: proxies.length } : null
  }
  return null
}

/** Путь удаляемой записи. Провайдер и подсписок — отображения по имени, порядка у них нет, только адрес */
function removePath(md: MihomoDoc, kind: Kind, name: string, slot: ReturnType<typeof recordSlot>): SchemaPath | null {
  if (slot !== null) return [...slot.list, slot.index]
  if (kind === 'provider') return providersOf(md).some((p) => p.name === name) ? ['proxy-providers', name] : null
  if (kind === 'subrule') return subRuleEntries(md).some((s) => s.name === name) ? ['sub-rules', name] : null
  return null
}

/**
 * Чем именно группа заслужила узел подстановки. Панель дописывает хосты по
 * КЛЮЧАМ документа — маркер `# LEAVE THIS LINE!` декоративен и здесь не
 * читается вовсе. Ветка `else` достижима только через `include-all` ПОСЛЕ
 * `remnawave.include-proxies: false`: без него группа уже попала бы в первую
 * ветку — панель дописывает хосты сама, ядру их собирать не нужно.
 */
function hostsBasis(group: MihomoGroup): string {
  if (panelInjectsHosts(group)) {
    return `Панель допишет имена подставленных хостов в конец списка proxies группы «${group.name}».`
  }
  return `У группы «${group.name}» стоит include-all: панель ничего не дописывает, но ядро соберёт хосты из корневого списка proxies, куда панель их положила.`
}

/**
 * Узел подстановки. Всё здесь условно («если панель подставит…»): состав хостов
 * и их имена задаёт панель по примечаниям хоста, редактор их не знает и знать
 * не может — отсюда и закрытые гнёзда у узла.
 *
 * Владелец узла — ГРУППА либо корневой `proxies`, и имена их сталкиваются:
 * группу могут назвать `root`. На холсте в этом случае побеждает узел группы
 * (см. `buildMihomoGraph`), поэтому карточка спрашивает про группу ПЕРВОЙ и тем
 * же предикатом, что и граф. Иначе у группы с именем `root` карточка говорила
 * бы про корневой список и тут же печатала фильтр этой группы.
 */
function HostsCard({ md, owner }: { md: MihomoDoc; owner: string }) {
  const group = groupsOf(md).find((g) => g.name === owner)
  if (group === undefined || !groupTakesHosts(group)) {
    return owner === 'root' ? (
      <>
        <p>
          Серверы подписки панель допишет в конец корневого списка proxies. Если панель подставит
          хосты, они окажутся здесь, и на них смогут ссылаться группы.
        </p>
        <p className="muted">
          Из узла не выходит кабель: имена подставленных хостов известны только панели, и сослаться
          на них из документа заранее нельзя.
        </p>
      </>
    ) : (
      <p className="muted">Подстановки «{owner}» в документе больше нет.</p>
    )
  }
  return (
    <>
      <p>
        {hostsBasis(group)}{' '}
        {group.filter !== undefined || group.excludeFilter !== undefined
          ? 'Если панель подставит хосты, сюда попадут те из них, что пройдут фильтр группы.'
          : 'Если панель подставит хосты, они окажутся здесь.'}
      </p>
      {group.filter !== undefined && <p className="muted mono">filter: {group.filter}</p>}
      {group.excludeFilter !== undefined && (
        <p className="muted mono">exclude-filter: {group.excludeFilter}</p>
      )}
      {/* Условно, как и весь остальной текст карточки: подставит панель хосты
          или нет — редактор не знает, он видит только ключи документа */}
      {group.remnawave.selectRandomProxy === true && (
        <p className="muted">Если хосты будут подставлены, сюда попадёт один случайный.</p>
      )}
      {group.remnawave.shuffleProxiesOrder === true && (
        <p className="muted">Если хосты будут подставлены, порядок будет случайным.</p>
      )}
      <p className="muted">
        Из узла не выходит кабель: имена подставленных хостов известны только панели, и сослаться на
        них из документа заранее нельзя.
      </p>
    </>
  )
}

interface Props {
  draft: MihomoDraft
  md: MihomoDoc
  /** Узел, который просят показать; используется, только пока выбора нет */
  nodeId: string
  /** Закрытие инспектора; по умолчанию просто снимается выбор узла */
  onClose?: () => void
}

export function MihomoInspector({ draft, md, nodeId, onClose }: Props) {
  // Источник ОДИН — выбранный в черновике узел. Проп остаётся входом «покажи
  // вот этот узел» и работает, пока выбора нет вовсе, — на этом стоят прямые
  // рендеры в тестах.
  const shownId = draft.selectedNode ?? nodeId
  const kind = kindOf(shownId)
  const name = shownId.slice(shownId.indexOf(':') + 1)
  const refs = useMemo(() => mihomoRefs(md), [md])
  const slot = recordSlot(md, kind, name)
  const removal = removePath(md, kind, name, slot)

  function move(dir: -1 | 1) {
    if (slot === null) return
    const ops: DocOp[] = [{ op: 'move', path: slot.list, from: slot.index, to: slot.index + dir }]
    // Только у правила порядок и есть его адрес (id узла кодирует индекс) —
    // переставленное ведёт выбор за собой. Группа и сервер адресуются именем,
    // и перестановка индекса на выбор не влияет.
    if (kind === 'rule') draft.applyOps(ops, `rule:${slot.index + dir}`)
    else draft.applyOps(ops)
  }

  function remove() {
    if (removal === null) return
    draft.applyOps([{ op: 'remove', path: removal }], null)
  }

  const removeLabel = REMOVE_LABEL[kind]

  return (
    <aside className="wb-inspector">
      <div className="wb-inspector-head">
        <div className="row">
          <span className="eyebrow">{KIND_LABEL[kind]}</span>
          <span className="spacer" />
          <Button
            variant="ghost"
            onClick={() => (onClose ? onClose() : draft.setSelectedNode(null))}
            aria-label="Закрыть"
          >
            ✕
          </Button>
        </div>
        <span className="mono">{shownId}</span>

        {slot !== null && (
          <div className="row">
            <span className="muted">
              порядок: {slot.index + 1} из {slot.length}
            </span>
            <span className="spacer" />
            <Button variant="ghost" disabled={slot.index <= 0} aria-label="Переместить выше" onClick={() => move(-1)}>
              Выше
            </Button>
            <Button
              variant="ghost"
              disabled={slot.index >= slot.length - 1}
              aria-label="Переместить ниже"
              onClick={() => move(1)}
            >
              Ниже
            </Button>
          </div>
        )}
      </div>

      <div className="wb-inspector-body">
        <div className="inspector-form">
          {kind === 'group' &&
            (slot === null ? (
              <p className="muted">Группы «{name}» в документе больше нет.</p>
            ) : (
              <MihomoGroupForm
                value={(valueAt(md.json, [...slot.list, slot.index]) as Record<string, unknown> | undefined) ?? {}}
                path={[...slot.list, slot.index]}
                writer={draft.writer}
                refs={refs}
                name={name}
                onRename={(to) => draft.rename('group', name, to)}
              />
            ))}
          {kind === 'proxy' &&
            (slot === null ? (
              <p className="muted">Сервера «{name}» в документе больше нет.</p>
            ) : (
              <MihomoProxyForm
                value={(valueAt(md.json, [...slot.list, slot.index]) as Record<string, unknown> | undefined) ?? {}}
                path={[...slot.list, slot.index]}
                writer={draft.writer}
                refs={refs}
                name={name}
                onRename={(to) => draft.rename('proxy', name, to)}
              />
            ))}
          {kind === 'provider' &&
            (!providersOf(md).some((p) => p.name === name) ? (
              <p className="muted">Провайдера «{name}» в документе больше нет.</p>
            ) : (
              <MihomoProviderForm
                value={(valueAt(md.json, ['proxy-providers', name]) as Record<string, unknown> | undefined) ?? {}}
                path={['proxy-providers', name]}
                writer={draft.writer}
                refs={refs}
                name={name}
                onRename={(to) => draft.rename('provider', name, to)}
              />
            ))}
          {kind === 'rule' &&
            (slot === null ? (
              <p className="muted">Правила #{Number(name) + 1} в документе больше нет.</p>
            ) : (
              <MihomoRuleForm
                raw={rulesOf(md).find((r) => r.index === slot.index)?.raw ?? ''}
                path={[...slot.list, slot.index]}
                writer={draft.writer}
                refs={refs}
              />
            ))}
          {kind === 'subrule' &&
            (() => {
              const entry = subRuleEntries(md).find((s) => s.name === name)
              if (entry === undefined) return <p className="muted">Подсписка «{name}» в документе больше нет.</p>
              const rules = ruleEntriesOf(md, entry.node).map((e) => valueAt(md.json, ['sub-rules', name, e.index]) as string)
              return (
                <MihomoSubRuleForm
                  rules={rules}
                  path={['sub-rules', name]}
                  writer={draft.writer}
                  refs={refs}
                  name={name}
                  onRename={(to) => draft.rename('sub-rule', name, to)}
                />
              )
            })()}
          {kind === 'hosts' && <HostsCard md={md} owner={name} />}
          {kind === 'builtin' && (
            <p>{BUILTIN_DOC[name] ?? 'Встроенная цель ядра: в документе она не объявляется.'}</p>
          )}
          {kind === 'settings' && <MihomoDocPanel draft={draft} md={md} />}
          {kind === 'other' && <p className="muted">Для этого узла формы нет.</p>}
        </div>
      </div>

      {removeLabel !== undefined && removal !== null && (
        <div className="wb-inspector-foot">
          <Button variant="danger" onClick={remove}>
            {removeLabel}
          </Button>
          <span className="spacer" />
        </div>
      )}
    </aside>
  )
}

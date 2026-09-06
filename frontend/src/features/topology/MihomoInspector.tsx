// Инспектор выбранного узла шаблона Mihomo — зеркало NodeInspector у Xray:
// разводка по префиксу id узла и та же оболочка .wb-inspector. Вкладки «JSON
// узла» здесь нет и быть не может: узел — это место в ТЕКСТЕ документа, а не
// самостоятельный объект, и печать его обратно уничтожила бы якоря с маркерами.

import {
  fieldsOf,
  groupsOf,
  hasRootMarker,
  locateMihomo,
  panelInjectsHosts,
  providersOf,
  rulesOf,
  type MihomoDoc,
  type MihomoGroup,
} from '../../entities/mihomo'
import { Button } from '../../shared/ui'
import { MihomoFieldsForm } from '../inspector/MihomoFieldsForm'
import { MihomoRuleForm } from '../inspector/MihomoRuleForm'
import type { MihomoDraft } from '../editor/useMihomoDraft'

type Kind = 'group' | 'rule' | 'provider' | 'hosts' | 'subrule' | 'builtin' | 'other'

const KIND_LABEL: Record<Kind, string> = {
  group: 'группа',
  rule: 'правило',
  provider: 'провайдер',
  hosts: 'подстановка',
  subrule: 'подсписок',
  builtin: 'встроенная цель',
  other: 'узел',
}

/** Что делает встроенная цель ядра. Карточка справочная: править тут нечего. */
const BUILTIN_DOC: Record<string, string> = {
  DIRECT: 'Соединение идёт напрямую, минуя прокси.',
  REJECT: 'Соединение отклоняется: клиент сразу получает отказ.',
  'REJECT-DROP': 'Пакеты отбрасываются молча, без ответа клиенту.',
  PASS: 'Правило пропускается — решение принимает следующее совпавшее правило.',
  COMPATIBLE: 'Служебная заглушка ядра: подставляется там, где группа осталась пустой.',
}

function kindOf(nodeId: string): Kind {
  const prefix = nodeId.slice(0, nodeId.indexOf(':'))
  return prefix === 'group' ||
    prefix === 'rule' ||
    prefix === 'provider' ||
    prefix === 'hosts' ||
    prefix === 'subrule' ||
    prefix === 'builtin'
    ? prefix
    : 'other'
}

function GroupCard({ md, name, draft }: { md: MihomoDoc; name: string; draft: MihomoDraft }) {
  const group = groupsOf(md).find((g) => g.name === name)
  if (group === undefined) return <p className="muted">Группы «{name}» в документе больше нет.</p>
  return (
    <MihomoFieldsForm
      md={md}
      parts={['proxy-groups', group.index]}
      fields={fieldsOf('proxy-group')}
      draft={draft}
    />
  )
}

function ProviderCard({ md, name, draft }: { md: MihomoDoc; name: string; draft: MihomoDraft }) {
  const provider = providersOf(md).find((p) => p.name === name)
  if (provider === undefined) return <p className="muted">Провайдера «{name}» в документе больше нет.</p>
  return (
    <MihomoFieldsForm
      md={md}
      parts={['proxy-providers', name]}
      fields={fieldsOf('proxy-provider')}
      draft={draft}
    />
  )
}

/**
 * Чем именно группа заслужила узел подстановки. Оснований четыре, и маркер
 * среди них ЛИШЬ ОДНО: `include-all` и ключи выборки заводят узел без всякого
 * маркера, а `include-all` — ещё и без ключа `proxies` в группе. Безусловное
 * «маркер стоит в списке proxies группы» отправляло бы пользователя искать в
 * тексте строку, которой там нет (находка ревью, финальный раунд).
 *
 * Порядок веток — от того, что видно в тексте, к тому, что выведено из ключей;
 * он не обязан совпадать с порядком проверок в `panelInjectsHosts` (тот решает
 * «да/нет», а не «почему»). Ветка `else` достижима только при одном из ключей
 * выборки: остальные основания разобраны выше, а без всех четырёх узла бы не
 * было вовсе.
 */
function hostsBasis(group: MihomoGroup): string {
  if (group.hasMarker) return `Маркер подстановки стоит в списке proxies группы «${group.name}».`
  if (group.includeAll) {
    return `У группы «${group.name}» стоит include-all — она забирает всё, что есть в документе, и маркер в её списке proxies для этого не нужен.`
  }
  const key =
    group.remnawave.selectRandomProxy === true ? 'select-random-proxy' : 'shuffle-proxies-order'
  return `У группы «${group.name}» стоит ключ remnawave.${key} — маркера в её списке proxies для подстановки не требуется.`
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
  if (group === undefined || !panelInjectsHosts(group)) {
    return owner === 'root' && hasRootMarker(md) ? (
      <>
        <p>
          Маркер подстановки стоит в корневом списке proxies. Если панель подставит хосты, они
          окажутся здесь, и на них смогут ссылаться группы.
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

/**
 * Подсписок правил — только для чтения. Формы инспектора спека перечисляет
 * поимённо, подсписков среди них нет: правки принимают путь до жёсткого `rules`,
 * и вторая их семья ради секции из одного эталонного шаблона не окупается.
 * Свобода правки не теряется — текст владеет файлом.
 */
function SubRuleCard({ md, name, draft }: { md: MihomoDoc; name: string; draft: MihomoDraft }) {
  const range = locateMihomo(md, ['sub-rules', name])
  // Текст подсписка показываем срезом исходника, строка в строку: пересобирать
  // его из модели незачем — читателю нужен именно тот текст, который он потом
  // увидит на вкладке YAML.
  const lines =
    range === null
      ? []
      : md.text
          .slice(range.from, range.to)
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
  return (
    <>
      <p className="muted">
        Подсписок правится на вкладке YAML: правки формы адресуют только основной список rules.
      </p>
      {range === null ? (
        <p className="muted">Подсписка «{name}» в документе больше нет.</p>
      ) : (
        lines.map((line, i) => (
          <div key={`${i}:${line}`} className="mono">
            {line}
          </div>
        ))
      )}
      {/* Переход и прокрутка — одно действие черновика: порознь они не
          собираются, см. revealAt в useDocumentDraft */}
      <Button onClick={() => draft.revealAt(['sub-rules', name])}>Открыть в YAML</Button>
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
  // Источник ОДИН — выбранный в черновике узел. Кнопки «Выше»/«Ниже»/«Удалить»
  // действуют на выбор (`moveSelected`/`removeSelected` адресуют его, а не
  // переданный проп), и разойдись эти два источника, кнопка удалила бы не то,
  // что на экране. Проп остаётся входом «покажи вот этот узел» и работает,
  // пока выбора нет вовсе, — на этом и стоят прямые рендеры в тестах.
  const shownId = draft.selectedNode ?? nodeId
  const kind = kindOf(shownId)
  const name = shownId.slice(shownId.indexOf(':') + 1)
  const ruleIndex = kind === 'rule' ? Number(name) : -1
  const ruleCount = rulesOf(md).length

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

        {kind === 'rule' && (
          <div className="row">
            <span className="muted">
              порядок: {ruleIndex + 1} из {ruleCount}
            </span>
            <span className="spacer" />
            <Button
              variant="ghost"
              disabled={ruleIndex <= 0}
              aria-label="Переместить правило выше"
              onClick={() => draft.moveSelected(-1)}
            >
              Выше
            </Button>
            <Button
              variant="ghost"
              disabled={ruleIndex >= ruleCount - 1}
              aria-label="Переместить правило ниже"
              onClick={() => draft.moveSelected(1)}
            >
              Ниже
            </Button>
          </div>
        )}
      </div>

      <div className="wb-inspector-body">
        <div className="inspector-form">
          {kind === 'group' && <GroupCard md={md} name={name} draft={draft} />}
          {kind === 'provider' && <ProviderCard md={md} name={name} draft={draft} />}
          {kind === 'rule' && <MihomoRuleForm md={md} index={ruleIndex} draft={draft} />}
          {kind === 'hosts' && <HostsCard md={md} owner={name} />}
          {kind === 'subrule' && <SubRuleCard md={md} name={name} draft={draft} />}
          {kind === 'builtin' && (
            <p>{BUILTIN_DOC[name] ?? 'Встроенная цель ядра: в документе она не объявляется.'}</p>
          )}
          {kind === 'other' && <p className="muted">Для этого узла формы нет.</p>}
        </div>
      </div>

      {(kind === 'group' || kind === 'rule') && (
        <div className="wb-inspector-foot">
          <Button variant="danger" onClick={() => draft.removeSelected()}>
            {kind === 'group' ? 'Удалить группу' : 'Удалить правило'}
          </Button>
          <span className="spacer" />
        </div>
      )}
    </aside>
  )
}

export { inspectorWidth, resyncEdges } from './GraphCanvas'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Connection, Edge } from '@xyflow/react'
import {
  blockingInjectPrefix, expandBlockedByPanelTags, expandSelector,
  type TraceResult, type XrayConfig,
} from '../../entities/xray'
import { buildGraph, COLUMN_X, layoutColumns } from '../../entities/graph/buildGraph'
import { edgeId, outboundTargets } from '../../entities/graph/edgeIds'
import type { GraphContext, IssueCount } from '../../entities/graph/types'
import {
  addBalancer, addInbound, addInjectGroup, addOutbound, addRule, attachInboundToRule,
  attachInjectGroupToBalancer, attachOutboundToBalancer, blockingGroupPrefix, connectRule,
  disconnectEdge, setRuleBalancer, setRuleInjectGroup, setRuleOutbound,
} from '../../entities/graph/mutations'
import { Button, Dialog } from '../../shared/ui'
import { edgeTypes } from './edges'
import { GraphCanvas } from './GraphCanvas'
import { nodeTypes } from './nodes'
import { usePositionsStore } from './positionsStore'

interface Props {
  /**
   * Ключ документа в хранилище позиций: `<вид>:<uuid>`, а не голый uuid —
   * uuid профиля и шаблона могут совпасть, и узлы двух графов смешались бы
   * в одной записи (см. shared/lib/docKey).
   */
  docKey: string
  config: XrayConfig
  ctx: GraphContext
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
  onChangeConfig: (next: XrayConfig) => void
  /** Результат трассировки: вердикты на узлах правил и подсветка победившего пути */
  trace?: TraceResult
  /** Дополнительные контролы в первой строке дока (поиск, тумблеры инструментов) */
  dockExtra?: ReactNode
  /** Раскрытый инструмент — вторая строка дока, чтобы он не растил его вширь */
  dockRow?: ReactNode
  /** Счётчики проблем по id узла — рисуются значком */
  issues?: Record<string, IssueCount>
  /** Запрос центрирования на узле (из поиска) */
  focus?: { nodeId: string; nonce: number } | null
  /** Открыть библиотеку рецептов; кнопка появляется только когда обработчик передан */
  onOpenRecipes?: () => void
  /**
   * Разрешить заводить группы подстановки с холста. Директива `remnawave` бывает
   * только у шаблона подписки, поэтому в редакторе профиля кнопки нет — тот же
   * приём, что у onOpenRecipes: кнопка появляется, только когда её передали.
   */
  allowInject?: boolean
}

// Индекс правила, зашитый в id ребра (`rule:{i}`), для сортировки перед батч-удалением.
// Рёбра без индекса правила (например squad->inbound) сохраняют относительный порядок в конце.
const RULE_INDEX = /rule:(\d+)/
const EDGE_BAL_OUT = /^e:bal:(.+)->out:(.+)$/
const EDGE_BAL_INJ = /^e:bal:(.+)->inj:(\d+)$/

function ruleIndexOf(edgeId: string): number {
  const m = RULE_INDEX.exec(edgeId)
  return m ? Number(m[1]) : -1
}

/**
 * Что можно коммутировать: inbound уходит в правило или напрямую в outbound
 * (тогда правило создаётся само), правило — в балансер либо в outbound, балансер —
 * в outbound. Гнёзда сквадов и обсерватории закрыты: привязку сквадов задаёт панель
 * Remnawave, а связь обсерватории с балансером выводится из его стратегии.
 * Группы подстановки — такие же выходы, только их outbound'ы создаст панель,
 * поэтому вести в них можно из правил и балансеров, а выходить из них нельзя.
 */
export function isValidConnection(conn: { source?: string | null; target?: string | null }): boolean {
  const source = conn.source ?? ''
  const target = conn.target ?? ''
  if (source === target) return false
  if (source.startsWith('in:')) return target.startsWith('rule:') || target.startsWith('out:')
  if (source.startsWith('rule:')) {
    return target.startsWith('out:') || target.startsWith('bal:') || target.startsWith('inj:')
  }
  if (source.startsWith('bal:')) return target.startsWith('out:') || target.startsWith('inj:')
  return false
}

/** Применяет протянутый кабель к конфигу. Недопустимая пара возвращает ТОТ ЖЕ config. */
export function applyConnection(
  config: XrayConfig,
  conn: { source?: string | null; target?: string | null },
): XrayConfig {
  const source = conn.source ?? ''
  const target = conn.target ?? ''
  if (source.startsWith('in:') && target.startsWith('out:')) {
    return connectRule(config, source.slice(3), target.slice(4))
  }
  if (source.startsWith('in:') && target.startsWith('rule:')) {
    return attachInboundToRule(config, source.slice(3), Number(target.slice(5)))
  }
  if (source.startsWith('rule:') && target.startsWith('out:')) {
    return setRuleOutbound(config, Number(source.slice(5)), target.slice(4))
  }
  if (source.startsWith('rule:') && target.startsWith('bal:')) {
    return setRuleBalancer(config, Number(source.slice(5)), target.slice(4))
  }
  if (source.startsWith('bal:') && target.startsWith('out:')) {
    return attachOutboundToBalancer(config, source.slice(4), target.slice(4))
  }
  if (source.startsWith('rule:') && target.startsWith('inj:')) {
    return setRuleInjectGroup(config, Number(source.slice(5)), Number(target.slice(4)))
  }
  if (source.startsWith('bal:') && target.startsWith('inj:')) {
    return attachInjectGroupToBalancer(config, source.slice(4), Number(target.slice(4)))
  }
  return config
}

/** Колонки, куда вообще можно воткнуть кабель. Ключ — префикс id узла. */
const TARGET_KINDS = ['rule', 'out', 'bal', 'inj'] as const

const COLUMNS = [
  { kind: 'squad', title: 'сквады', x: COLUMN_X.squad },
  { kind: 'inbound', title: 'inbound', x: COLUMN_X.inbound },
  { kind: 'rule', title: 'правила', x: COLUMN_X.rule },
  { kind: 'balancer', title: 'балансеры', x: COLUMN_X.balancer },
  { kind: 'outbound', title: 'outbound', x: COLUMN_X.outbound },
] as const

/** Состояние правила для бейджа на узле: победитель отделён от обычного совпадения */
export function traceStateOf(
  result: TraceResult | undefined,
  ruleIndex: number,
): 'yes' | 'no' | 'unknown' | 'winner' | undefined {
  if (!result) return undefined
  const shown = result.ipVerdicts ?? result.verdicts
  const verdict = shown.find((v) => v.index === ruleIndex)
  if (!verdict) return undefined
  return result.winner?.ruleIndex === ruleIndex ? 'winner' : verdict.state
}

/** Значок проблем на узле: ошибка перевешивает предупреждения, счёт — общий */
export function issueBadgeOf(
  issues: Record<string, IssueCount> | undefined,
  nodeId: string,
): { level: 'error' | 'warn'; total: number } | undefined {
  const count = issues?.[nodeId]
  if (!count) return undefined
  const total = count.errors + count.warnings
  if (total === 0) return undefined
  return { level: count.errors > 0 ? 'error' : 'warn', total }
}

/** Кабели победившего пути: входы → правило → выход. Дефолтный маршрут правил не задействует. */
export function tracedEdgeIds(result: TraceResult | undefined, config: XrayConfig): Set<string> {
  const ids = new Set<string>()
  const index = result?.winner?.ruleIndex
  if (index === undefined || index === null) return ids
  const rule = config.routing?.rules?.[index]
  if (!rule) return ids
  // Тот же резолвер, что у buildGraph: иначе подсветка целится в узел, которого нет
  const targetFor = outboundTargets(config)
  const inboundTags = (config.inbounds ?? []).map((i) => i.tag)
  const scope = rule.inboundTag?.length
    ? rule.inboundTag.filter((t) => inboundTags.includes(t))
    : inboundTags
  for (const tag of scope) ids.add(edgeId(`in:${tag}`, `rule:${index}`))
  if (rule.outboundTag) {
    const target = targetFor(rule.outboundTag)
    if (target !== undefined) ids.add(edgeId(`rule:${index}`, target))
  }
  if (rule.balancerTag) {
    ids.add(edgeId(`rule:${index}`, `bal:${rule.balancerTag}`))
    // Победителя среди кандидатов редактор не знает — подсвечиваем всех.
    // Set сам схлопывает несколько предсказанных тегов одной группы в одно ребро.
    for (const tag of result?.winner?.balancerCandidates ?? []) {
      const target = targetFor(tag)
      if (target !== undefined) ids.add(edgeId(`bal:${rule.balancerTag}`, target))
    }
  }
  return ids
}

export function TopologyView({
  docKey,
  config,
  ctx,
  selectedId,
  onSelect,
  onChangeConfig,
  trace,
  dockExtra,
  dockRow,
  issues,
  focus,
  onOpenRecipes,
  allowInject,
}: Props) {
  const saved = usePositionsStore((s) => s.positions[docKey])

  // Граф пересобирается только от конфига и контекста панели. Трассировка сюда
  // не входит намеренно: иначе каждый символ в строке адреса создавал бы все узлы
  // заново, а вместе с ними перезапускалась бы анимация появления (узлы мигали
  // и не успевали проявиться).
  const graph = useMemo(() => {
    const g = buildGraph(config, ctx)
    return { nodes: layoutColumns(g.nodes), edges: g.edges }
  }, [config, ctx])

  const computed = useMemo(() => {
    const traced = tracedEdgeIds(trace, config)
    const laid = graph.nodes.map((n) => {
      const traceState = n.data.kind === 'rule' ? traceStateOf(trace, n.data.index as number) : undefined
      const issueCount = issues?.[n.id]
      // Ссылку на data сохраняем, когда доклеивать нечего: React Flow сравнивает
      // объекты по ссылке, и новый объект на каждый ввод — лишняя перерисовка
      const data =
        traceState === undefined && issueCount === undefined
          ? n.data
          : {
              ...n.data,
              ...(traceState === undefined ? {} : { traceState }),
              ...(issueCount === undefined ? {} : { issueCount }),
            }
      return {
        ...n,
        deletable: false,
        position: saved?.[n.id] ?? n.position,
        selected: n.id === selectedId,
        data,
      }
    })
    // Кабели, касающиеся выбранного узла или лежащие на трассе, подсвечиваются
    // бегущим пунктиром — видно весь путь трафика от входа до выхода
    const wired = graph.edges.map((e) => ({
      ...e,
      type: 'signal',
      data: {
        active:
          traced.has(e.id) ||
          (selectedId !== null && (e.source === selectedId || e.target === selectedId)),
      },
    }))
    return { nodes: laid, edges: wired }
  }, [graph, config, saved, selectedId, trace, issues])

  // Запрос на разворот префикса selector — ставится при разрыве префиксного ребра
  const [expand, setExpand] = useState<{ balancerTag: string; outboundTag: string } | null>(null)
  // Запрос про неразрешимый префикс на ребре балансер → группа подстановки
  const [groupBlock, setGroupBlock] = useState<{ balancerTag: string; prefix: string } | null>(null)

  const onConnect = useCallback(
    (conn: Connection) => {
      const next = applyConnection(config, conn)
      if (next !== config) onChangeConfig(next)
    },
    [config, onChangeConfig],
  )

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      // Id узлов/рёбер правил позиционные (`rule:{i}`), а disconnectEdge для ребра
      // rule->out делает splice по индексу правила. При батч-удалении нескольких рёбер
      // за один вызов последовательные splice сдвигают индексы оставшихся правил, поэтому
      // сортируем по индексу правила по убыванию — тогда более поздние правила удаляются
      // первыми и не смещают индексы ещё не обработанных.
      // При равном индексе правила сперва обрабатываем e:in:...->rule:i (просто фильтрует
      // inboundTag, индексы не смещает), и только потом e:rule:i->out:... (делает splice)
      // — тег должен вычиститься до splice правила.
      const isRuleOut = (id: string) => (id.startsWith('e:rule:') ? 1 : 0)
      const sorted = [...deleted].sort((a, b) => {
        const byIndex = ruleIndexOf(b.id) - ruleIndexOf(a.id)
        if (byIndex !== 0) return byIndex
        return isRuleOut(a.id) - isRuleOut(b.id)
      })
      // Ребро балансер → выход, кандидат которого пришёл из префикса, disconnectEdge
      // не трогает: убрать одного, не переписав selector, нельзя. Спрашиваем разрешение.
      let pending: { balancerTag: string; outboundTag: string } | null = null
      let groupPending: { balancerTag: string; prefix: string } | null = null
      let next = config
      for (const edge of sorted) {
        const before = next
        next = disconnectEdge(next, edge.id)
        const m = EDGE_BAL_OUT.exec(edge.id)
        if (next === before && m) pending = { balancerTag: m[1]!, outboundTag: m[2]! }
        const inj = EDGE_BAL_INJ.exec(edge.id)
        if (next === before && inj) {
          const prefix = blockingGroupPrefix(next, inj[1]!, Number(inj[2]))
          if (prefix !== undefined) groupPending = { balancerTag: inj[1]!, prefix }
        }
      }
      if (next !== config) onChangeConfig(next)
      // Ровно один диалог за раз: разворот префикса предлагает действие,
      // объяснение тупика группы — только текст, поэтому оно уступает
      if (pending) setExpand(pending)
      else if (groupPending) setGroupBlock(groupPending)
    },
    [config, onChangeConfig],
  )

  const noRules = (config.routing?.rules?.length ?? 0) === 0

  // Если префикс держит и кандидата, и группу подстановки, expandSelector вернёт тот же
  // конфиг — кнопка «Развернуть префикс» в диалоге ниже обманывала бы пользователя.
  // Теги от панели запрещают разворот целиком, и объяснение у него своё
  const panelBlocked = expand ? expandBlockedByPanelTags(config, expand.balancerTag) : false
  const blocked =
    expand && !panelBlocked
      ? blockingInjectPrefix(config, expand.balancerTag, expand.outboundTag)
      : undefined

  return (
    <GraphCanvas
      docKey={docKey}
      nodes={computed.nodes}
      edges={computed.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      selectedId={selectedId}
      onSelect={onSelect}
      isValidConnection={isValidConnection}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      targetKinds={TARGET_KINDS}
      columns={COLUMNS}
      focus={focus}
      hint={
        noRules ? (
          <>Правил пока нет. Протяните кабель от гнезда inbound к outbound — правило создастся само.</>
        ) : undefined
      }
      dockActions={
        <>
          <Button onClick={() => onChangeConfig(addInbound(config))}>+ Inbound</Button>
          <Button onClick={() => onChangeConfig(addOutbound(config))}>+ Outbound</Button>
          <Button onClick={() => onChangeConfig(addRule(config))}>+ Правило</Button>
          <Button onClick={() => onChangeConfig(addBalancer(config))}>+ Балансер</Button>
          {allowInject && (
            <Button onClick={() => onChangeConfig(addInjectGroup(config))}>+ Подстановка</Button>
          )}
          {onOpenRecipes && <Button onClick={onOpenRecipes}>+ Рецепт</Button>}
        </>
      }
      dockExtra={dockExtra}
      dockRow={dockRow}
    >
      <Dialog open={expand !== null} title="Убрать выход из балансера" onClose={() => setExpand(null)}>
        {panelBlocked ? (
          <>
            <p>
              В шаблоне есть группа подстановки, теги которой задаёт панель. Какие именно выходы
              она подставит, редактор не знает — значит любой префикс селектора может ловить их, и
              развернуть селектор в точные теги нельзя: подставленные выходы молча выпали бы из
              балансера.
            </p>
            <p className="muted">
              Уберите кандидата вручную в форме балансера либо переведите группу на префикс тегов
              в её форме — тогда разворот снова станет возможен.
            </p>
            <div className="row">
              <span className="spacer" />
              <Button variant="ghost" onClick={() => setExpand(null)}>
                Понятно
              </Button>
            </div>
          </>
        ) : blocked !== undefined ? (
          <>
            <p>
              Префикс «{blocked}» ловит и выход «{expand?.outboundTag}», и группу подстановки.
              Развернуть его в точные теги нельзя: сколько серверов подставит панель, знает только
              она — в селекторе замёрзли бы три предсказанных тега.
            </p>
            <p className="muted">
              Переименуйте выход так, чтобы он не попадал под префикс, либо правьте селектор в форме
              балансера.
            </p>
            <div className="row">
              <span className="spacer" />
              <Button variant="ghost" onClick={() => setExpand(null)}>
                Понятно
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              Кандидат «{expand?.outboundTag}» попал в балансер «{expand?.balancerTag}» по префиксу.
              Чтобы убрать только его, селектор придётся переписать точными тегами остальных
              кандидатов.
            </p>
            <div className="row">
              <span className="spacer" />
              <Button variant="ghost" onClick={() => setExpand(null)}>
                Отмена
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (expand) {
                    onChangeConfig(expandSelector(config, expand.balancerTag, expand.outboundTag))
                  }
                  setExpand(null)
                }}
              >
                Развернуть префикс
              </Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog
        open={groupBlock !== null}
        title="Убрать группу из балансера"
        onClose={() => setGroupBlock(null)}
      >
        <p>
          Префикс «{groupBlock?.prefix}» ловит и группу подстановки, и обычный выход балансера
          «{groupBlock?.balancerTag}». Убрать одну группу, не потеряв статического кандидата, им
          нельзя.
        </p>
        <p className="muted">
          Разведите их: переименуйте статический выход либо задайте группе другой префикс тегов в
          её форме.
        </p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setGroupBlock(null)}>
            Понятно
          </Button>
        </div>
      </Dialog>
    </GraphCanvas>
  )
}

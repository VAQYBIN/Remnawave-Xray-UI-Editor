// Граф Mihomo поверх общего канваса: сборка узлов, коммутация и объяснение
// отказов. Всё, что не зависит от вида документа (позиции, фокус, патчбей,
// док, подписи колонок), живёт в GraphCanvas.

import { useCallback, useMemo, type ReactNode } from 'react'
import type { Connection, Edge } from '@xyflow/react'
import { buildMihomoGraph, layoutMihomo } from '../../entities/graph/mihomo/buildGraph'
import { isValidMihomoConnection } from '../../entities/graph/mihomo/mutations'
import type { FlowNode } from '../../entities/graph/types'
import {
  nextRulePlacement,
  providerName,
  ruleProviderName,
  startGroup,
  startListener,
  startProvider,
  startProxy,
  startRuleProvider,
  startSubRule,
  subRuleName,
  type MihomoDoc,
} from '../../entities/mihomo'
import type { MihomoTraceResult } from '../../entities/mihomo/trace'
import type { MihomoDraft } from '../editor/useMihomoDraft'
import { Button, Dialog, MenuButton, type MenuItem } from '../../shared/ui'
import { edgeTypes } from './edges'
import { GraphCanvas } from './GraphCanvas'
import { mihomoNodeTypes } from './mihomoNodes'
import { usePositionsStore } from './positionsStore'

const COLUMN_TITLE: Record<string, string> = {
  'mihomo-rule': 'правила',
  // Подсписок стоит в колонке правил и один, без правил, её не переименовывает
  'mihomo-subrule': 'правила',
  'mihomo-group': 'группы',
}

/**
 * Подписи колонок. У Xray колонок ровно пять и они заданы константой; здесь
 * число колонок групп зависит от глубины ссылок в конкретном документе, поэтому
 * колонки считаются по факту. Вид колонки — вид её ПЕРВОГО узла, и вида в
 * колонке не обязательно один: в колонке правил рядом с правилами стоят
 * подсписки (`COLUMN_TITLE` выше даёт им ту же подпись именно поэтому), а в
 * колонке выходов смешаны провайдеры, подстановки и встроенные цели — её
 * `COLUMN_TITLE` не знает вовсе, и она получает подпись «выходы» умолчанием.
 *
 * Вид берём из `data.kind`, а не из `node.type`: в графе Mihomo это намеренно
 * разные имена (`type: 'mihomoGroup'` при `kind: 'mihomo-group'`), и по `type`
 * подписи молча обнулились бы — GraphCanvas сверяет колонку именно с `kind`.
 */
export function mihomoColumns(nodes: FlowNode[]): { kind: string; title: string; x: number }[] {
  const seen = new Map<number, string>()
  for (const node of nodes) {
    if (!seen.has(node.position.x)) seen.set(node.position.x, String(node.data.kind))
  }
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, kind]) => ({ kind, x, title: COLUMN_TITLE[kind] ?? 'выходы' }))
}

/** Тип правила по id его узла — нужен проверке допустимости соединения */
function ruleTypeOf(nodes: FlowNode[], id: string | null | undefined): string | undefined {
  const node = nodes.find((n) => n.id === id)
  return node?.data.kind === 'mihomo-rule' ? (node.data.type as string) : undefined
}

/**
 * Допустимость соединения с учётом ТИПА правила-источника. Долг плана 1: без
 * типа кабель от узла SUB-RULE тянулся бы вхолостую — гнездо подсвечивалось бы
 * как валидное, а операция отказывала бы уже после отпускания мыши.
 * Экспортируется ради теста: внутри компонента её не проверить.
 */
export function canConnect(
  nodes: FlowNode[],
  conn: { source?: string | null; target?: string | null },
): boolean {
  return isValidMihomoConnection(
    conn.source ?? '',
    conn.target ?? '',
    ruleTypeOf(nodes, conn.source),
  )
}

/**
 * Колонки, куда вообще можно воткнуть кабель. Ключ — префикс id узла.
 * Экспортируется ради теста: каждый вид отсюда обязан иметь правило подсветки в
 * tokens.css, иначе `data-accepts` проставится, а цель не подсветится — кабель
 * тянется вслепую.
 */
export const MIHOMO_TARGET_KINDS = ['group', 'provider', 'proxy', 'builtin'] as const

/** Пункты меню «+ Добавить». Порядок — от самого частого действия к самому редкому. */
export const ADD_ITEMS: MenuItem[] = [
  { id: 'group', label: 'Группа' },
  { id: 'proxy', label: 'Сервер' },
  { id: 'provider', label: 'Провайдер' },
  { id: 'rule-provider', label: 'Набор правил' },
  { id: 'sub-rule', label: 'Подсписок' },
  { id: 'listener', label: 'Вход' },
]

/**
 * Заводит запись со стартером и переносит выбор: у записи с узлом — на узел,
 * у записи без узла (набор, вход) — на панель «Документ», где она и правится.
 * Чистая функция рядом с `nextRulePlacement` (`entities/mihomo/starters.ts`) и
 * по той же причине: внутри компонента её не проверить.
 */
export function addFromMenu(
  draft: Pick<MihomoDraft, 'applyOps' | 'setSelectedNode'>,
  md: MihomoDoc,
  id: string,
): void {
  const root = md.json as Record<string, unknown>
  const len = (key: string) => (Array.isArray(root[key]) ? (root[key] as unknown[]).length : 0)
  switch (id) {
    case 'group': {
      const v = startGroup(md)
      draft.applyOps(
        [{ op: 'insert', path: ['proxy-groups'], index: len('proxy-groups'), value: v }],
        `group:${v.name as string}`,
      )
      return
    }
    case 'proxy': {
      const v = startProxy(md)
      draft.applyOps(
        [{ op: 'insert', path: ['proxies'], index: len('proxies'), value: v }],
        `proxy:${v.name as string}`,
      )
      return
    }
    case 'provider': {
      const name = providerName(md)
      draft.applyOps(
        [{ op: 'set', path: ['proxy-providers', name], value: startProvider(md, name) }],
        `provider:${name}`,
      )
      return
    }
    case 'rule-provider': {
      const name = ruleProviderName(md)
      draft.applyOps(
        [{ op: 'set', path: ['rule-providers', name], value: startRuleProvider(md, name) }],
        'doc:settings',
      )
      return
    }
    case 'sub-rule': {
      const name = subRuleName(md)
      draft.applyOps([{ op: 'set', path: ['sub-rules', name], value: startSubRule() }], `subrule:${name}`)
      return
    }
    case 'listener':
      draft.applyOps(
        [{ op: 'insert', path: ['listeners'], index: len('listeners'), value: startListener(md) }],
        'doc:settings',
      )
      return
    default:
      return
  }
}

/** Индекс правила выбранного узла; null — выбран не узел правила (или ничего) */
function selectedRuleIndex(id: string | null): number | null {
  return id?.startsWith('rule:') ? Number(id.slice(5)) : null
}

/**
 * Состояние правила для бейджа на карточке: победитель отделён от обычного
 * совпадения, как у Xray. Правила, до которых проход не дошёл, вердикта не
 * имеют — и бейджа не получают: у них не «нет данных», их просто не проверяли.
 * Экспортируется ради теста: внутри компонента её не проверить.
 */
export function mihomoTraceStateOf(
  result: MihomoTraceResult | undefined,
  ruleIndex: number,
): 'yes' | 'no' | 'unknown' | 'winner' | undefined {
  if (!result) return undefined
  const verdict = result.verdicts.find((v) => v.index === ruleIndex)
  if (!verdict) return undefined
  return result.winner?.ruleIndex === ruleIndex ? 'winner' : verdict.state
}

export function MihomoTopology({
  draft,
  md,
  dockExtra,
  dockRow,
}: {
  draft: MihomoDraft
  md: MihomoDoc
  /** Дополнительные контролы в первой строке дока (тумблеры инструментов) */
  dockExtra?: ReactNode
  /** Раскрытый инструмент — вторая строка дока, чтобы он не растил его вширь */
  dockRow?: ReactNode
}) {
  const saved = usePositionsStore((s) => s.positions[draft.storageKey])

  const graph = useMemo(() => {
    const g = buildMihomoGraph(md)
    return { nodes: layoutMihomo(g.nodes), edges: g.edges }
  }, [md])

  const computed = useMemo(() => {
    const nodes = graph.nodes.map((n) => {
      const issueCount = draft.nodeIssues[n.id]
      // Вид узла берём из `data.kind`, а не из `node.type`: в графе Mihomo это
      // намеренно разные имена, и по `type` вердикт молча не проставился бы
      const traceState =
        n.data.kind === 'mihomo-rule'
          ? mihomoTraceStateOf(draft.trace, n.data.index as number)
          : undefined
      return {
        ...n,
        deletable: false,
        // Узел, который писатель перетащил руками, остаётся там, куда его
        // положили: раскладка по колонкам — только начальное приближение
        position: saved?.[n.id] ?? n.position,
        selected: n.id === draft.selectedNode,
        // Ссылку на data сохраняем, когда доклеивать нечего: React Flow
        // сравнивает объекты по ссылке
        data:
          issueCount === undefined && traceState === undefined
            ? n.data
            : {
                ...n.data,
                ...(issueCount === undefined ? {} : { issueCount }),
                ...(traceState === undefined ? {} : { traceState }),
              },
      }
    })
    const edges = graph.edges.map((e) => ({
      ...e,
      type: 'signal',
      data: {
        active:
          draft.selectedNode !== null &&
          (e.source === draft.selectedNode || e.target === draft.selectedNode),
      },
    }))
    return { nodes, edges }
  }, [graph, saved, draft.selectedNode, draft.nodeIssues, draft.trace])

  // Считается по узлам, а не по документу, и меняется только вместе с графом.
  // Инлайн в JSX давал бы новый массив на каждый рендер — `useMemo` внутри
  // GraphCanvas тогда пересчитывался бы всегда и не мемоизировал ничего.
  const columns = useMemo(() => mihomoColumns(graph.nodes), [graph.nodes])

  const isValid = useCallback(
    (conn: { source?: string | null; target?: string | null }) => canConnect(graph.nodes, conn),
    [graph.nodes],
  )

  const onConnect = useCallback(
    (conn: Connection) => draft.connect(conn.source ?? '', conn.target ?? ''),
    [draft],
  )

  // Разрыв нескольких рёбер разом уходит одним вызовом: черновик
  // (`useMihomoDraft.disconnect`) сам накладывает разрывы по очереди на
  // ТЕКУЩИЙ на тот момент документ и пишет результат в историю одним снимком
  // — топологии больше незачем отказывать целиком и спрашивать подтверждение.
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return
      draft.disconnect(deleted.map((e) => e.id))
    },
    [draft],
  )

  return (
    <GraphCanvas
      docKey={draft.storageKey}
      nodes={computed.nodes}
      edges={computed.edges}
      nodeTypes={mihomoNodeTypes}
      edgeTypes={edgeTypes}
      selectedId={draft.selectedNode}
      onSelect={draft.setSelectedNode}
      isValidConnection={isValid}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      targetKinds={MIHOMO_TARGET_KINDS}
      columns={columns}
      focus={draft.focus}
      hint={
        graph.nodes.length === 0 ? (
          // Утверждать «документ пуст» нельзя: узлов нет и у документа с `port`,
          // `mode` и `dns`. Утверждать «в документе нет групп» — тоже: запись
          // `- type: select` без имени группой не считается (`groupsOf`
          // пропускает её), диагностики на неё сейчас нет, и холст соврал бы,
          // отрицая то, что писатель видит в тексте. Верно и всегда — «редактор
          // не нашёл»: это утверждение о разборе, а не о содержимом файла.
          //
          // Условие ЗДЕСЬ — число узлов графа, не «нет групп/серверов/правил/
          // провайдеров» по документу: `hosts:root` рисуется у ЛЮБОГО документа-
          // отображения независимо от того, есть ли в нём хоть одна группа, сервер,
          // правило или провайдер (см. тесты ниже про документ с одними `port`/
          // `mode`), и его карточка на холсте — уже достаточный сигнал «редактор
          // разобрал документ», подсказка о неудачном разборе тогда лишняя. Условие
          // «нет групп/серверов/правил/провайдеров» дало бы её и там, где холст
          // явно не пуст — заменять его не стоит.
          <>
            Редактор не нашёл в документе ни одной группы, правила, сервера или провайдера.
            Заведите их кнопками ниже или впишите на вкладке YAML.
          </>
        ) : undefined
      }
      dockActions={
        <>
          <Button
            onClick={() => {
              const { raw, at } = nextRulePlacement(md, selectedRuleIndex(draft.selectedNode))
              draft.applyOps([{ op: 'insert', path: ['rules'], index: at, value: raw }], `rule:${at}`)
            }}
          >
            + Правило
          </Button>
          <MenuButton label="+ Добавить" items={ADD_ITEMS} onPick={(id) => addFromMenu(draft, md, id)} />
          {/* Секции без узлов на холсте (наборы правил, входы) живут в панели «Документ» */}
          <Button variant="ghost" onClick={() => draft.setSelectedNode('doc:settings')}>
            Документ
          </Button>
        </>
      }
      dockExtra={dockExtra}
      dockRow={dockRow}
    >
      <Dialog
        open={draft.refusal !== null}
        // Заголовок нейтральный: `draft.refusal` — общий канал отказа писателя,
        // а не только кабеля. Его ставит и `applyOpsNow` на отказ ЛЮБОЙ операции
        // (все шесть пунктов «+ Добавить», «+ Правило»), не только `connect`/
        // `disconnect` — «Так соединить нельзя» соврало бы про отказ, у которого
        // кабеля не было вовсе. Причину и в этом случае называет сам текст
        // отказа (`refusalText` для кабеля, текст писателя для остального).
        title="Правка не применена"
        onClose={draft.dismissRefusal}
      >
        <p>{draft.refusal ?? ''}</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={draft.dismissRefusal}>
            Понятно
          </Button>
        </div>
      </Dialog>
    </GraphCanvas>
  )
}

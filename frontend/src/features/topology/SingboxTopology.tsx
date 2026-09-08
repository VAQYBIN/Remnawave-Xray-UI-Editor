// Граф sing-box поверх общего канваса: сборка узлов, коммутация и объяснение
// отказов. Всё, что не зависит от вида документа (позиции, фокус, патчбей, док,
// подписи колонок), живёт в GraphCanvas и здесь не повторяется.

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Connection, Edge, Node } from '@xyflow/react'
import {
  buildSingboxGraph,
  layoutSingbox,
} from '../../entities/graph/singbox/buildGraph'
import {
  addRule,
  connectSingbox,
  disconnectSingbox,
  isValidSingboxConnection,
  singboxRefusalText,
  type SingboxEditResult,
  type SingboxRefusal,
} from '../../entities/graph/singbox/mutations'
import type { SingboxDoc, SingboxRule, SingboxTraceResult } from '../../entities/singbox'
import type { SingboxDraft } from '../editor/useSingboxDraft'
import { Button, Dialog } from '../../shared/ui'
import { edgeTypes } from './edges'
import { GraphCanvas } from './GraphCanvas'
import { singboxNodeTypes } from './singboxNodes'
import { usePositionsStore } from './positionsStore'

const COLUMN_TITLE: Record<string, string> = {
  'singbox-inbound': 'входы',
  'singbox-rule': 'правила',
  'singbox-group': 'группы',
}

/**
 * Подписи колонок. Полос четыре, но колонок больше: полоса групп разворачивается
 * по глубине ссылок конкретного документа, поэтому колонки считаются по факту, а
 * не задаются константой. Колонка выходов смешивает серверы, эндпоинты,
 * подстановку и встроенные действия — `COLUMN_TITLE` её не знает вовсе, и она
 * получает подпись «выходы» умолчанием.
 *
 * Вид узла берём из `data.kind`, а не из `node.type`: это намеренно разные имена
 * (`type: 'singboxGroup'` при `kind: 'singbox-group'`), и по `type` подписи молча
 * обнулились бы — GraphCanvas сверяет колонку именно с `kind`.
 */
export function singboxColumns(nodes: Node[]): { kind: string; title: string; x: number }[] {
  const seen = new Map<string, { kind: string; title: string; x: number }>()
  for (const node of nodes) {
    const kind = String((node.data as { kind?: unknown }).kind ?? '')
    // Ключ — вид ВМЕСТЕ с координатой: колонок вида `singbox-group` бывает
    // несколько, и по одному только виду вторая и следующие потерялись бы
    const key = `${kind}:${node.position.x}`
    if (seen.has(key)) continue
    seen.set(key, { kind, title: COLUMN_TITLE[kind] ?? 'выходы', x: node.position.x })
  }
  return [...seen.values()].sort((a, b) => a.x - b.x)
}

/**
 * Колонки, куда вообще можно воткнуть кабель. Ключ — префикс id узла.
 * Экспортируется ради теста: каждый вид отсюда обязан иметь правило подсветки в
 * tokens.css, иначе `data-accepts` проставится, а цель не подсветится — кабель
 * тянется вслепую.
 */
export const SINGBOX_TARGET_KINDS = ['group', 'out'] as const

/**
 * Состояние правила для бейджа на карточке: победитель отделён от обычного
 * совпадения. Правила, до которых проход не дошёл, вердикта не имеют — и бейджа
 * не получают: у них не «нет данных», их просто не проверяли.
 * Экспортируется ради теста: внутри компонента её не проверить.
 */
export function singboxTraceStateOf(
  result: SingboxTraceResult | undefined,
  ruleIndex: number,
): 'yes' | 'no' | 'unknown' | 'winner' | undefined {
  if (result === undefined) return undefined
  if (result.winner?.ruleIndex === ruleIndex) return 'winner'
  return result.verdicts.find((v) => v.index === ruleIndex)?.state
}

/**
 * Заготовка нового правила: совпадает со всем и ведёт в прямой выход. Цель
 * обязательна — правило без выхода ядру не конфиг, и заводить кнопкой заведомо
 * невалидную запись нельзя.
 */
export function nextRule(): SingboxRule {
  return { domain: [], outbound: 'direct' }
}

export function SingboxTopology({
  draft,
  doc,
  dockExtra,
  dockRow,
}: {
  draft: SingboxDraft
  doc: SingboxDoc
  /** Дополнительные контролы в первой строке дока (тумблеры инструментов) */
  dockExtra?: ReactNode
  /** Раскрытый инструмент — вторая строка дока, чтобы он не растил его вширь */
  dockRow?: ReactNode
}) {
  const saved = usePositionsStore((s) => s.positions[draft.storageKey])

  const graph = useMemo(() => {
    const g = buildSingboxGraph(doc)
    return { nodes: layoutSingbox(g.nodes), edges: g.edges }
  }, [doc])

  const computed = useMemo(() => {
    const nodes = graph.nodes.map((n) => {
      const issueCount = draft.nodeIssues[n.id]
      // Вид узла берём из `data.kind`, а не из `node.type`: это намеренно разные
      // имена, и по `type` вердикт молча не проставился бы ни одному правилу
      const traceState =
        n.data.kind === 'singbox-rule'
          ? singboxTraceStateOf(draft.trace, n.data.index as number)
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
  const columns = useMemo(() => singboxColumns(graph.nodes), [graph.nodes])

  // Отказ мутации: кабель, отскакивающий молча, читается как поломка редактора
  const [refusal, setRefusal] = useState<SingboxRefusal | null>(null)

  const apply = useCallback(
    (result: SingboxEditResult) => {
      if (result.doc === undefined) {
        setRefusal(result.refusal ?? 'not-found')
        return
      }
      draft.changeDoc(result.doc)
    },
    [draft],
  )

  const isValid = useCallback(
    (conn: { source?: string | null; target?: string | null }) =>
      isValidSingboxConnection(conn.source ?? '', conn.target ?? ''),
    [],
  )

  const onConnect = useCallback(
    (conn: Connection) => apply(connectSingbox(doc, conn.source ?? '', conn.target ?? '')),
    [apply, doc],
  )

  // Попытка разорвать несколько рёбер разом: отказываем целиком и объясняем
  const [multiCut, setMultiCut] = useState(false)

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return
      // Одно ребро за раз. Каждая правка строится по ТЕКУЩЕМУ документу, а
      // документ меняется только после перерисовки: вторая правка поверх первой
      // считалась бы по устаревшему снимку и попала бы не туда — у групп сдвиг
      // индексов в списке `outbounds` виден сразу.
      //
      // Отсюда следует ОТКАЗ, а не «сделать одну и промолчать»: молчаливое
      // частичное выполнение — это порча, писатель видит исчезнувшие рёбра и не
      // знает, что применилось.
      if (deleted.length > 1) {
        setMultiCut(true)
        return
      }
      apply(disconnectSingbox(doc, deleted[0]!.id))
    },
    [apply, doc],
  )

  return (
    <GraphCanvas
      docKey={draft.storageKey}
      nodes={computed.nodes}
      edges={computed.edges}
      nodeTypes={singboxNodeTypes}
      edgeTypes={edgeTypes}
      selectedId={draft.selectedNode}
      onSelect={draft.setSelectedNode}
      isValidConnection={isValid}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      targetKinds={SINGBOX_TARGET_KINDS}
      columns={columns}
      focus={draft.focus}
      hint={
        graph.nodes.length === 0 ? (
          // Утверждать «документ пуст» нельзя: узлов нет и у документа с одними
          // `log`, `dns` и `experimental`. Верно и всегда — «редактор не нашёл»:
          // это утверждение о разборе, а не о содержимом файла.
          <>
            Редактор не нашёл в документе ни одного входа, правила или выхода. Заведите правило
            кнопкой ниже или впишите записи на вкладке JSON.
          </>
        ) : undefined
      }
      dockActions={<Button onClick={() => draft.changeDoc(addRule(doc, nextRule()))}>+ Правило</Button>}
      dockExtra={dockExtra}
      dockRow={dockRow}
    >
      <Dialog
        open={refusal !== null}
        title="Так соединить нельзя"
        onClose={() => setRefusal(null)}
      >
        <p>{refusal ? singboxRefusalText(refusal) : ''}</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setRefusal(null)}>
            Понятно
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={multiCut}
        title="За раз разрывается одна связь"
        onClose={() => setMultiCut(false)}
      >
        <p>
          Выделено несколько кабелей. Каждая правка строится по текущему документу, поэтому вторую
          нельзя наложить поверх первой, не пересобрав его заново — а частично выполненный разрыв
          хуже невыполненного: непонятно, что применилось.
        </p>
        <p className="muted">Снимите выделение, выберите один кабель и повторите.</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setMultiCut(false)}>
            Понятно
          </Button>
        </div>
      </Dialog>
    </GraphCanvas>
  )
}

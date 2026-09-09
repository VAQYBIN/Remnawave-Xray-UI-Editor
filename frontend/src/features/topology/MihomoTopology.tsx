// Граф Mihomo поверх общего канваса: сборка узлов, коммутация и объяснение
// отказов. Всё, что не зависит от вида документа (позиции, фокус, патчбей,
// док, подписи колонок), живёт в GraphCanvas.

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Connection, Edge } from '@xyflow/react'
import { buildMihomoGraph, layoutMihomo } from '../../entities/graph/mihomo/buildGraph'
import { isValidMihomoConnection } from '../../entities/graph/mihomo/mutations'
import type { FlowNode } from '../../entities/graph/types'
import { groupsOf, rulesOf, type MihomoDoc } from '../../entities/mihomo'
import type { MihomoTraceResult } from '../../entities/mihomo/trace'
import type { MihomoDraft } from '../editor/useMihomoDraft'
import { Button, Dialog } from '../../shared/ui'
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
export const MIHOMO_TARGET_KINDS = ['group', 'provider', 'builtin'] as const

/**
 * Имя новой группы: `Группа`, `Группа 2`, `Группа 3`… — первое, которого нет в
 * документе. Совпадение имён — диагностируемая ошибка документа, и заводить её
 * кнопкой нельзя.
 */
export function nextGroupName(md: MihomoDoc): string {
  const taken = new Set(groupsOf(md).map((g) => g.name))
  if (!taken.has('Группа')) return 'Группа'
  for (let n = 2; ; n += 1) {
    const name = `Группа ${n}`
    if (!taken.has(name)) return name
  }
}

/**
 * Куда и чем кнопка «+ Правило» заводит новое правило. Раньше она всегда слала
 * `MATCH,DIRECT` в конец списка — а в живом шаблоне последним правилом стоит
 * `MATCH`, и в Mihomo выигрывает ПЕРВОЕ совпавшее: новое правило рождалось
 * мёртвым, до него проход не доходил никогда.
 *
 * Поэтому при финальном `MATCH` заготовка встаёт ПЕРЕД ним, и она не `MATCH`:
 * второй `MATCH` перед финальным сделал бы мёртвым уже финальный — редактор
 * молча поменял бы маршрут по умолчанию. `DOMAIN-SUFFIX,example.com,DIRECT` —
 * безобидная заготовка: она видна на холсте, её сразу правят в форме, и до
 * правки она не меняет судьбу ни одного реального адреса.
 *
 * `MATCH` в конце нет (правил нет вовсе, или список кончается обычным правилом)
 * — прежнее поведение: `MATCH,DIRECT` в конец, где он как раз уместен.
 *
 * Чистая функция рядом с `nextGroupName` и по той же причине: внутри компонента
 * её не проверить, а решение о ТЕКСТЕ и МЕСТЕ — про кнопку, а не про черновик.
 */
export function nextRulePlacement(md: MihomoDoc): { raw: string; at?: number } {
  const rules = rulesOf(md)
  const last = rules[rules.length - 1]
  if (last?.rule?.type !== 'MATCH') return { raw: 'MATCH,DIRECT' }
  return { raw: 'DOMAIN-SUFFIX,example.com,DIRECT', at: last.index }
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

  // Попытка разорвать несколько рёбер разом: отказываем целиком и объясняем
  const [multiCut, setMultiCut] = useState(false)

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return
      // Одно ребро за раз: у Mihomo нет позиционных id, которые смещались бы
      // друг относительно друга, но каждая правка считает отступы по ТЕКУЩЕМУ
      // тексту, а текст меняется только после перерисовки — вторая правка
      // поверх первой без пересчёта попала бы не туда.
      //
      // Отсюда следует ОТКАЗ, а не «сделать одну и промолчать»: молчаливое
      // частичное выполнение — это порча, писатель видит исчезнувшие рёбра и не
      // знает, что применилось. Накладывать по одной с перепарсингом между
      // правками тоже можно, но пачечная операция должна жить в черновике
      // (`useMihomoDraft`), где есть текст, — не в топологии.
      if (deleted.length > 1) {
        setMultiCut(true)
        return
      }
      draft.disconnect([deleted[0]!.id])
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
          <>
            Редактор не нашёл в документе ни одной группы, правила или провайдера. Заведите группу
            и правило кнопками ниже или впишите их на вкладке YAML.
          </>
        ) : undefined
      }
      dockActions={
        <>
          <Button
            onClick={() => {
              const { raw, at } = nextRulePlacement(md)
              draft.addRuleText(raw, at)
            }}
          >
            + Правило
          </Button>
          <Button onClick={() => draft.addGroupNamed(nextGroupName(md))}>+ Группа</Button>
        </>
      }
      dockExtra={dockExtra}
      dockRow={dockRow}
    >
      <Dialog
        open={draft.refusal !== null}
        title="Так соединить нельзя"
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

      <Dialog
        open={multiCut}
        title="За раз разрывается одна связь"
        onClose={() => setMultiCut(false)}
      >
        <p>
          Выделено несколько кабелей. Каждая правка считает отступы по текущему тексту документа,
          поэтому вторую нельзя наложить поверх первой, не пересчитав его заново — а частично
          выполненный разрыв хуже невыполненного: непонятно, что применилось.
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

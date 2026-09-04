import { useMemo, useState } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { matchPrefixes, subjectCovers, type XrayConfig } from '../../entities/xray'
import { getNodeJson } from '../../entities/graph/mutations'
import { xrayIntellisense, type XrayRootKind } from '../editor/intellisense'
import { Button, Dialog } from '../../shared/ui'
import { InboundForm } from '../inspector/InboundForm'
import { OutboundForm } from '../inspector/OutboundForm'
import { RuleForm } from '../inspector/RuleForm'
import { DnsForm } from '../inspector/DnsForm'
import { BalancerForm, type ObservatoryState } from '../inspector/BalancerForm'
import { ObservatoryForm } from '../inspector/ObservatoryForm'
import { InjectGroupForm } from '../inspector/InjectGroupForm'

const inspectorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--void)', fontSize: '12px', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
  '.cm-gutters': { backgroundColor: 'var(--void)', borderRight: '1px solid var(--rail)' },
})

type Obj = Record<string, unknown>

const KIND_LABEL: Record<string, string> = {
  inbound: 'вход',
  outbound: 'выход',
  rule: 'правило',
  balancer: 'балансер',
  dns: 'резолвер',
  observatory: 'проверка живости',
  inject: 'подстановка',
  other: 'узел',
}

/** Состояние глобальной обсерватории для карточки балансера */
function observatoryState(config: XrayConfig, balancer: Obj): ObservatoryState | undefined {
  const strategy = (balancer.strategy as { type?: string } | undefined)?.type
  if (strategy !== 'leastPing' && strategy !== 'leastLoad') return undefined
  const section = strategy === 'leastLoad' ? config.burstObservatory : config.observatory
  const candidates = matchPrefixes(
    (config.outbounds ?? []).map((o) => o.tag),
    balancer.selector as string[] | undefined,
  )
  return {
    present: section !== undefined,
    missing:
      section === undefined
        ? []
        : candidates.filter((t) => !subjectCovers(section.subjectSelector, t)),
  }
}

interface Props {
  config: XrayConfig
  nodeId: string
  inboundSquads?: Record<string, string[]>
  onApply: (value: unknown) => void
  onRemove: () => void
  onClose: () => void
  /** Перестановка правила (только для rule-узлов); dir: -1 — выше, +1 — ниже */
  onMoveRule?: (dir: -1 | 1) => void
  /** Завести глобальную секцию обсерватории по кнопке из карточки балансера */
  onSetupObservatory?: (kind: 'observatory' | 'burst', subjects: string[]) => void
}

function parseNode(text: string): Obj | null {
  try {
    const v = JSON.parse(text) as unknown
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null
  } catch {
    return null
  }
}

export function NodeInspector({
  config,
  nodeId,
  inboundSquads,
  onApply,
  onRemove,
  onClose,
  onMoveRule,
  onSetupObservatory,
}: Props) {
  const original = useMemo(() => JSON.stringify(getNodeJson(config, nodeId) ?? {}, null, 2), [config, nodeId])
  const [text, setText] = useState(original)
  const [parseError, setParseError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [retagValue, setRetagValue] = useState<Obj | null>(null)

  const kind = nodeId.startsWith('in:')
    ? 'inbound'
    : nodeId.startsWith('out:')
      ? 'outbound'
      : nodeId.startsWith('rule:')
        ? 'rule'
        : nodeId.startsWith('bal:')
          ? 'balancer'
          : nodeId === 'dns'
            ? 'dns'
            : nodeId === 'obs'
              ? 'observatory'
              : nodeId.startsWith('inj:')
                ? 'inject'
                : 'other'
  // Автоподсказки/hover питаются от узла docSchema, с которого начинается документ.
  // Узел obs — фрагмент корня конфига (две его секции), поэтому корень там 'config';
  // у группы подстановки и «прочих» узлов схемы нет — там только подсветка JSON:
  // секции remnawave в docSchema нет.
  const rootKind: XrayRootKind | null =
    kind === 'inbound' ||
    kind === 'outbound' ||
    kind === 'rule' ||
    kind === 'dns' ||
    kind === 'balancer'
      ? kind
      : kind === 'observatory'
        ? 'config'
        : null
  const extensions = useMemo(
    () => [json(), ...(rootKind ? [xrayIntellisense(rootKind)] : []), inspectorTheme],
    [rootKind],
  )
  const [tab, setTab] = useState<'form' | 'json'>(kind === 'other' ? 'json' : 'form')
  const parsedNode = useMemo(() => parseNode(text), [text])
  const oldTag = kind === 'inbound' ? nodeId.slice(3) : ''
  const ruleIndex = kind === 'rule' ? Number(nodeId.slice(5)) : -1
  const ruleCount = config.routing?.rules?.length ?? 0
  const showJson = tab === 'json' || kind === 'other'

  function apply() {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setParseError('Некорректный JSON')
      return
    }
    // Узел конфига — всегда объект; число или массив молча сломали бы конфиг
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('Узел должен быть JSON-объектом')
      return
    }
    setParseError(null)
    const node = parsed as Obj
    if (kind === 'inbound' && node.tag !== oldTag && (inboundSquads?.[oldTag]?.length ?? 0) > 0) {
      // Панель привязывает сквады к тегу — предупреждаем о потере привязки
      setRetagValue(node)
      return
    }
    onApply(node)
  }

  return (
    <aside className="wb-inspector">
      <div className="wb-inspector-head">
        <div className="row">
          <span className="eyebrow">{KIND_LABEL[kind]}</span>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose} aria-label="Закрыть">
            ✕
          </Button>
        </div>
        <span className="mono">{nodeId}</span>

        {kind !== 'other' && (
          <div className="segmented">
            <Button aria-pressed={tab === 'form'} onClick={() => setTab('form')}>
              Форма
            </Button>
            <Button aria-pressed={tab === 'json'} onClick={() => setTab('json')}>
              JSON узла
            </Button>
          </div>
        )}

        {kind === 'rule' && onMoveRule && (
          <div className="row">
            <span className="muted">
              порядок: {ruleIndex + 1} из {ruleCount}
            </span>
            <span className="spacer" />
            {/* Перестановка меняет selectedNode → инспектор remount'ится; при
                неприменённых правках они потерялись бы молча — блокируем кнопки */}
            <Button
              variant="ghost"
              disabled={ruleIndex <= 0 || text !== original}
              aria-label="Переместить правило выше"
              onClick={() => onMoveRule(-1)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              disabled={ruleIndex >= ruleCount - 1 || text !== original}
              aria-label="Переместить правило ниже"
              onClick={() => onMoveRule(1)}
            >
              ↓
            </Button>
          </div>
        )}
      </div>

      <div className={showJson ? 'wb-inspector-body wb-inspector-body-flush' : 'wb-inspector-body'}>
        {!showJson && (
          <div className="inspector-form">
            {parsedNode === null && (
              <p className="muted">JSON узла некорректен — исправьте его на вкладке «JSON узла».</p>
            )}
            {parsedNode !== null && kind === 'inbound' && (
              <InboundForm value={parsedNode} onChange={(next) => setText(JSON.stringify(next, null, 2))} />
            )}
            {parsedNode !== null && kind === 'outbound' && (
              <OutboundForm
                value={parsedNode}
                onChange={(next) => setText(JSON.stringify(next, null, 2))}
                outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
              />
            )}
            {parsedNode !== null && kind === 'rule' && (
              <RuleForm
                value={parsedNode}
                onChange={(next) => setText(JSON.stringify(next, null, 2))}
                inboundTags={(config.inbounds ?? []).map((i) => i.tag)}
                outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
              />
            )}
            {parsedNode !== null && kind === 'dns' && (
              <DnsForm value={parsedNode} onChange={(next) => setText(JSON.stringify(next, null, 2))} />
            )}
            {parsedNode !== null && kind === 'balancer' && (
              <BalancerForm
                value={parsedNode}
                onChange={(next) => setText(JSON.stringify(next, null, 2))}
                outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
                observatory={observatoryState(config, parsedNode)}
                onSetupObservatory={onSetupObservatory}
              />
            )}
            {parsedNode !== null && kind === 'observatory' && (
              <ObservatoryForm
                value={parsedNode}
                onChange={(next) => setText(JSON.stringify(next, null, 2))}
                outboundTags={(config.outbounds ?? []).map((o) => o.tag)}
              />
            )}
            {parsedNode !== null && kind === 'inject' && (
              <InjectGroupForm
                value={parsedNode}
                onChange={(next) => setText(JSON.stringify(next, null, 2))}
              />
            )}
          </div>
        )}

        {showJson && (
          <CodeMirror
            key={`${nodeId}:${original}`}
            value={text}
            height="100%"
            theme="dark"
            extensions={extensions}
            onChange={setText}
          />
        )}
      </div>

      <div className="wb-inspector-foot">
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          Удалить узел
        </Button>
        <span className="spacer" />
        {parseError && <span className="field-error">{parseError}</span>}
        <Button variant="primary" onClick={apply} disabled={text === original}>
          Применить
        </Button>
      </div>

      <Dialog open={confirmOpen} title="Удалить узел" onClose={() => setConfirmOpen(false)}>
        <p>Удалить «{nodeId}» из конфига? Ссылки правил на него останутся и будут подсвечены как предупреждения.</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmOpen(false)
              onRemove()
            }}
          >
            Удалить
          </Button>
        </div>
      </Dialog>

      <Dialog open={retagValue !== null} title="Смена тега inbound" onClose={() => setRetagValue(null)}>
        <p>
          К тегу «{oldTag}» в панели привязаны сквады ({(inboundSquads?.[oldTag] ?? []).length}). После смены тега
          панель потеряет привязку — сквады придётся включить заново.
        </p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setRetagValue(null)}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (retagValue) onApply(retagValue)
              setRetagValue(null)
            }}
          >
            Сменить тег
          </Button>
        </div>
      </Dialog>
    </aside>
  )
}

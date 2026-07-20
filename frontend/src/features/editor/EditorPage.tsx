import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ConflictError,
  useProfile,
  useProfileInbounds,
  useSaveProfile,
  useSquads,
  type Profile,
  type ProfileInboundDetail,
  type SquadInfo,
} from '../../shared/api'
import { validateXrayConfig, type XrayConfig } from '../../entities/xray'
import type { GraphContext } from '../../entities/graph/types'
import { applyNodeJson, getNodeJson, removeNode } from '../../entities/graph/mutations'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Chip, Dialog } from '../../shared/ui'
import { TopologyView } from '../topology/TopologyView'
import { NodeInspector } from '../topology/NodeInspector'
import { useDraftStore, type Draft } from './draftStore'
import { IssueList } from './IssueList'
import { JsonView } from './JsonView'
import { SaveDialog } from './SaveDialog'

export function formatConfig(config: unknown): string {
  return JSON.stringify(config, null, 2)
}

export function resolveEditorText(draft: Draft | undefined, panelConfig: unknown): string {
  return draft ? draft.text : formatConfig(panelConfig)
}

export function toGraphContext(
  squads: SquadInfo[] | undefined,
  inbounds: ProfileInboundDetail[] | undefined,
): GraphContext {
  const inboundSquads: Record<string, string[]> = {}
  for (const inb of inbounds ?? []) inboundSquads[inb.tag] = inb.activeSquads
  return { squads: squads ?? [], inboundSquads }
}

export function nextSelection(
  selected: string | null,
  prev: XrayConfig,
  next: XrayConfig,
): string | null {
  if (!selected) return null
  if (getNodeJson(next, selected) === undefined) return null
  // rule-узлы адресуются позиционно: при изменении числа правил id может
  // указывать на другое правило — сбрасываем выбор
  if (selected.startsWith('rule:')) {
    const prevLen = prev.routing?.rules?.length ?? 0
    const nextLen = next.routing?.rules?.length ?? 0
    if (prevLen !== nextLen) return null
  }
  return selected
}

function EditorInner({ profile }: { profile: Profile }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { drafts, setDraft, clearDraft } = useDraftStore()
  const draft = drafts[profile.uuid]
  const text = resolveEditorText(draft, profile.config)
  const panelText = useMemo(() => formatConfig(profile.config), [profile.config])
  const dirty = draft !== undefined && draft.text !== panelText

  const validation = useMemo(() => validateXrayConfig(text), [text])
  const hasErrors = validation.issues.some((i) => i.level === 'error')

  const [tab, setTab] = useState<'topology' | 'json'>('topology')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const squads = useSquads()
  const panelInbounds = useProfileInbounds(profile.uuid)
  const ctx = useMemo(
    () => toGraphContext(squads.data, panelInbounds.data),
    [squads.data, panelInbounds.data],
  )
  // топология строится только по валидному (по схеме) документу
  const parsedConfig = validation.ok ? (validation.config as XrayConfig) : undefined

  function changeConfig(next: XrayConfig) {
    setDraft(profile.uuid, formatConfig(next), draft?.baseUpdatedAt ?? profile.updatedAt)
    setSelectedNode((cur) => nextSelection(cur, parsedConfig!, next))
  }

  const save = useSaveProfile(profile.uuid)
  const [saveOpen, setSaveOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [conflict, setConflict] = useState<Profile | null>(null)

  function doSave(expectedUpdatedAt: string) {
    save.mutate(
      { config: validation.config, expectedUpdatedAt },
      {
        onSuccess: () => {
          clearDraft(profile.uuid)
          setSaveOpen(false)
          setConflict(null)
        },
        onError: (err) => {
          if (err instanceof ConflictError) {
            setSaveOpen(false)
            setConflict(err.current)
          }
        },
      },
    )
  }

  const errorCount = validation.issues.filter((i) => i.level === 'error').length
  const warningCount = validation.issues.length - errorCount

  return (
    <main style={{ padding: '16px 24px' }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="ghost" onClick={() => navigate('/')}>
          ← Профили
        </Button>
        <h1>{profile.name}</h1>
        <div className="row-wrap">
          {profile.inbounds.map((inb) => (
            <Chip key={inb.uuid} dir="in">
              {inb.port != null ? `${inb.tag} :${inb.port}` : inb.tag}
            </Chip>
          ))}
        </div>
        <span className="spacer" />
        {dirty && <Chip dir="none">черновик</Chip>}
        <span className="muted">обновлён {relativeTime(profile.updatedAt)}</span>
      </div>

      <div className="row" style={{ gap: 4, marginBottom: 12 }}>
        <Button variant={tab === 'topology' ? 'primary' : 'ghost'} onClick={() => setTab('topology')}>Топология</Button>
        <Button
          variant={tab === 'json' ? 'primary' : 'ghost'}
          onClick={() => {
            setTab('json')
            setSelectedNode(null)
          }}
        >
          JSON
        </Button>
        <span className="spacer" />
        {validation.issues.length === 0 ? (
          <span style={{ color: 'var(--ok)' }}>Конфиг валиден</span>
        ) : (
          <span className="muted">
            {errorCount > 0 && <span className="field-error">ошибок: {errorCount}</span>}
            {errorCount > 0 && warningCount > 0 && ' · '}
            {warningCount > 0 && <span style={{ color: 'var(--out)' }}>предупреждений: {warningCount}</span>}
          </span>
        )}
        {save.isError && !(save.error instanceof ConflictError) && (
          <span className="field-error">{(save.error as Error).message}</span>
        )}
        <Button variant="ghost" disabled={!dirty} onClick={() => setResetOpen(true)}>
          Сбросить к версии панели
        </Button>
        <Button variant="primary" disabled={hasErrors || !dirty || save.isPending} onClick={() => setSaveOpen(true)}>
          Сохранить в панель
        </Button>
      </div>

      {validation.issues.length > 0 && <IssueList issues={validation.issues} />}

      {tab === 'json' && (
        <JsonView text={text} onChange={(value) => setDraft(profile.uuid, value, draft?.baseUpdatedAt ?? profile.updatedAt)} />
      )}
      {tab === 'topology' && parsedConfig === undefined && (
        <div className="empty">
          <h2>Конфиг не проходит валидацию</h2>
          <p>Исправьте ошибки на вкладке JSON — топология строится по валидному документу.</p>
        </div>
      )}
      {tab === 'topology' && parsedConfig !== undefined && (
        <div className="row" style={{ alignItems: 'stretch', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TopologyView
              profileUuid={profile.uuid}
              config={parsedConfig}
              ctx={ctx}
              selectedId={selectedNode}
              onSelect={setSelectedNode}
              onChangeConfig={changeConfig}
            />
          </div>
          {selectedNode && (
            <NodeInspector
              key={selectedNode}
              config={parsedConfig}
              nodeId={selectedNode}
              onApply={(value) => changeConfig(applyNodeJson(parsedConfig, selectedNode, value))}
              onRemove={() => {
                changeConfig(removeNode(parsedConfig, selectedNode))
                setSelectedNode(null)
              }}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </div>
      )}

      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        original={panelText}
        modified={text}
        issues={validation.issues}
        busy={save.isPending}
        onConfirm={() => doSave(draft?.baseUpdatedAt ?? profile.updatedAt)}
        error={save.isError && !(save.error instanceof ConflictError) ? (save.error as Error).message : undefined}
      />

      <Dialog open={resetOpen} title="Сбросить черновик" onClose={() => setResetOpen(false)}>
        <p>Отменить все локальные правки и вернуться к версии из панели?</p>
        <div className="row">
          <span className="spacer" />
          <Button variant="ghost" onClick={() => setResetOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              clearDraft(profile.uuid)
              setResetOpen(false)
            }}
          >
            Сбросить
          </Button>
        </div>
      </Dialog>

      <Dialog open={conflict !== null} title="Конфликт версий" onClose={() => setConflict(null)}>
        <p>
          Профиль был изменён в панели после открытия
          {conflict && <> (обновлён {relativeTime(conflict.updatedAt)})</>}. Выберите, что делать:
        </p>
        <div className="row">
          <span className="spacer" />
          <Button
            variant="ghost"
            onClick={() => {
              if (!conflict) return
              clearDraft(profile.uuid)
              qc.setQueryData(['profiles', profile.uuid], conflict)
              qc.invalidateQueries({ queryKey: ['profiles'], exact: true })
              setConflict(null)
            }}
          >
            Загрузить версию панели
          </Button>
          <Button
            variant="danger"
            disabled={save.isPending || hasErrors}
            onClick={() => {
              if (conflict) doSave(conflict.updatedAt)
            }}
          >
            Перезаписать
          </Button>
        </div>
      </Dialog>
    </main>
  )
}

export function EditorPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const profile = useProfile(uuid!)

  if (profile.isPending) return <main style={{ padding: 24 }} className="muted">Загрузка профиля…</main>
  if (profile.isError) return <main style={{ padding: 24 }} className="field-error">{(profile.error as Error).message}</main>
  return <EditorInner profile={profile.data} />
}

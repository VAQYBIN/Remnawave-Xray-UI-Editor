import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import { useQueryClient } from '@tanstack/react-query'
import { ConflictError, useProfile, useSaveProfile, type Profile } from '../../shared/api'
import { validateXrayConfig } from '../../entities/xray'
import { relativeTime } from '../../shared/lib/relativeTime'
import { Button, Chip, Dialog } from '../../shared/ui'
import { useDraftStore, type Draft } from './draftStore'
import { IssueList } from './IssueList'
import { SaveDialog } from './SaveDialog'

export function formatConfig(config: unknown): string {
  return JSON.stringify(config, null, 2)
}

export function resolveEditorText(draft: Draft | undefined, panelConfig: unknown): string {
  return draft ? draft.text : formatConfig(panelConfig)
}

const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', fontSize: '13px' },
  '.cm-content': { fontFamily: 'var(--font-mono)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)' },
})

function xrayLinter() {
  return linter((view) => {
    const res = validateXrayConfig(view.state.doc.toString())
    return res.issues.map(
      (issue): Diagnostic => ({
        from: 0,
        to: 0,
        severity: issue.level === 'error' ? 'error' : 'warning',
        message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
      }),
    )
  })
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

  const extensions = useMemo(() => [json(), lintGutter(), xrayLinter(), editorTheme], [])

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

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
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

      <CodeMirror
        value={text}
        height="calc(100vh - 240px)"
        theme="dark"
        extensions={extensions}
        onChange={(value) => setDraft(profile.uuid, value, draft?.baseUpdatedAt ?? profile.updatedAt)}
      />

      <IssueList issues={validation.issues} />

      <div className="row">
        <Button variant="primary" disabled={hasErrors || !dirty || save.isPending} onClick={() => setSaveOpen(true)}>
          Сохранить в панель
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={() => setResetOpen(true)}>
          Сбросить к версии панели
        </Button>
        {save.isError && !(save.error instanceof ConflictError) && (
          <span className="field-error">{(save.error as Error).message}</span>
        )}
      </div>

      <SaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        original={panelText}
        modified={text}
        issues={validation.issues}
        busy={save.isPending}
        onConfirm={() => doSave(draft?.baseUpdatedAt ?? profile.updatedAt)}
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

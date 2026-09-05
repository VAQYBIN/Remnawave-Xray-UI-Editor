import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { docStorageKey, LEGACY_DOC_KIND } from '../../shared/lib/docKey'

export interface Draft {
  text: string
  /** Версия панели, от которой отсчитан черновик: updatedAt профиля либо хэш шаблона */
  baseVersion: string
  savedAt: string
}

export interface DraftState {
  /** Ключ — не голый uuid, а `<вид>:<uuid>` (см. shared/lib/docKey) */
  drafts: Record<string, Draft>
  setDraft: (key: string, text: string, baseVersion: string) => void
  clearDraft: (key: string) => void
}

/** Одна запись черновика из localStorage: до v1 база звалась `baseUpdatedAt` */
function readDraft(raw: unknown, version: number): Draft | null {
  if (typeof raw !== 'object' || raw === null) return null
  const d = raw as { text?: unknown; baseUpdatedAt?: unknown; baseVersion?: unknown; savedAt?: unknown }
  if (typeof d.text !== 'string') return null
  const base = version >= 1 ? d.baseVersion : d.baseUpdatedAt
  return {
    text: d.text,
    baseVersion: typeof base === 'string' ? base : '',
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
  }
}

/**
 * Миграции черновиков.
 *
 * v0 → v1: база звалась `baseUpdatedAt`. У шаблонов подписки updatedAt нет —
 * базой служит хэш содержимого, и имя перестало быть правдой. Без миграции
 * `baseVersion` был бы undefined, тип `Draft` врал бы, а фактическую базу
 * подставлял бы fallback в `useConfigDraft` — черновик молча отсчитывался бы
 * не от своей версии.
 *
 * v1 → v2: ключом был голый uuid, а uuid профиля и шаблона могут совпасть.
 * Все существующие записи созданы редактором профилей (шаблоны появились уже
 * с префиксом), поэтому им достаётся `profile:`.
 *
 * Экспортируется ради теста: сам persist зовёт её в `migrate`, а проверять
 * хранилище через кэш модулей хрупко.
 */
export function migrateDraftState(state: unknown, version: number): DraftState {
  const base = (state ?? {}) as DraftState
  if (version >= 2) return base
  const source = (state as { drafts?: unknown } | null)?.drafts
  const old = typeof source === 'object' && source !== null ? (source as Record<string, unknown>) : {}
  const drafts: Record<string, Draft> = {}
  // В localStorage лежат данные, которые мы не контролируем: битую запись
  // пропускаем, иначе одна такая уронила бы всё хранилище черновиков
  for (const [uuid, raw] of Object.entries(old)) {
    const draft = readDraft(raw, version)
    if (draft) drafts[docStorageKey(LEGACY_DOC_KIND, uuid)] = draft
  }
  return { ...base, drafts }
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (key, text, baseVersion) =>
        set((s) => ({
          drafts: {
            ...s.drafts,
            [key]: { text, baseVersion, savedAt: new Date().toISOString() },
          },
        })),
      clearDraft: (key) =>
        set((s) => {
          const { [key]: _removed, ...rest } = s.drafts
          return { drafts: rest }
        }),
    }),
    {
      name: 'xui-drafts',
      version: 2,
      migrate: migrateDraftState,
    },
  ),
)

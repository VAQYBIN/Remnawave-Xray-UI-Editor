import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Draft {
  text: string
  /** Версия панели, от которой отсчитан черновик: updatedAt профиля либо хэш шаблона */
  baseVersion: string
  savedAt: string
}

export interface DraftState {
  drafts: Record<string, Draft>
  setDraft: (uuid: string, text: string, baseVersion: string) => void
  clearDraft: (uuid: string) => void
}

/**
 * Черновики v0 звали базу `baseUpdatedAt`. У шаблонов подписки updatedAt нет —
 * базой служит хэш содержимого, и имя перестало быть правдой. Без миграции
 * `baseVersion` был бы undefined, тип `Draft` врал бы, а фактическую базу
 * подставлял бы fallback в `useConfigDraft` — черновик молча отсчитывался бы
 * не от своей версии.
 *
 * Экспортируется ради теста: сам persist зовёт её в `migrate`, а проверять
 * хранилище через кэш модулей хрупко.
 */
export function migrateDraftState(state: unknown, version: number): DraftState {
  if (version >= 1) return state as DraftState
  const old = (state ?? {}) as {
    drafts?: Record<string, { text?: unknown; baseUpdatedAt?: unknown; savedAt?: unknown }>
  }
  const drafts: Record<string, Draft> = {}
  // В localStorage лежат данные, которые мы не контролируем: битую запись
  // пропускаем, иначе одна такая уронила бы всё хранилище черновиков
  for (const [uuid, d] of Object.entries(old.drafts ?? {})) {
    if (typeof d !== 'object' || d === null) continue
    if (typeof d.text !== 'string') continue
    drafts[uuid] = {
      text: d.text,
      baseVersion: typeof d.baseUpdatedAt === 'string' ? d.baseUpdatedAt : '',
      savedAt: typeof d.savedAt === 'string' ? d.savedAt : '',
    }
  }
  return { ...(state as DraftState), drafts }
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (uuid, text, baseVersion) =>
        set((s) => ({
          drafts: {
            ...s.drafts,
            [uuid]: { text, baseVersion, savedAt: new Date().toISOString() },
          },
        })),
      clearDraft: (uuid) =>
        set((s) => {
          const { [uuid]: _removed, ...rest } = s.drafts
          return { drafts: rest }
        }),
    }),
    {
      name: 'xui-drafts',
      version: 1,
      migrate: migrateDraftState,
    },
  ),
)

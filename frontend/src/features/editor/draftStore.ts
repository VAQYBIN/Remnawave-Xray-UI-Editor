import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Draft {
  text: string
  baseUpdatedAt: string
  savedAt: string
}

interface DraftState {
  drafts: Record<string, Draft>
  setDraft: (uuid: string, text: string, baseUpdatedAt: string) => void
  clearDraft: (uuid: string) => void
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (uuid, text, baseUpdatedAt) =>
        set((s) => ({
          drafts: {
            ...s.drafts,
            [uuid]: { text, baseUpdatedAt, savedAt: new Date().toISOString() },
          },
        })),
      clearDraft: (uuid) =>
        set((s) => {
          const { [uuid]: _removed, ...rest } = s.drafts
          return { drafts: rest }
        }),
    }),
    { name: 'xui-drafts' },
  ),
)

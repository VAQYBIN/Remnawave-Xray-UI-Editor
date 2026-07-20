import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { Profile } from './types'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<{ authenticated: boolean }>('/api/auth/me'),
    retry: false,
    staleTime: 60_000,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (password: string) =>
      apiFetch<{ ok: boolean }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.clear(),
  })
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => apiFetch<{ profiles: Profile[] }>('/api/profiles').then((r) => r.profiles),
  })
}

export function useProfile(uuid: string) {
  return useQuery({
    queryKey: ['profiles', uuid],
    queryFn: () => apiFetch<{ profile: Profile }>(`/api/profiles/${uuid}`).then((r) => r.profile),
  })
}

export function useCreateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; config: unknown }) =>
      apiFetch<{ profile: Profile }>('/api/profiles', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.profile),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })
}

export function useDeleteProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uuid: string) => apiFetch<{ ok: boolean }>(`/api/profiles/${uuid}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  })
}

export function useSaveProfile(uuid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { config?: unknown; name?: string; expectedUpdatedAt: string }) =>
      apiFetch<{ profile: Profile }>(`/api/profiles/${uuid}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((r) => r.profile),
    onSuccess: (profile) => {
      qc.setQueryData(['profiles', uuid], profile)
      qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
}

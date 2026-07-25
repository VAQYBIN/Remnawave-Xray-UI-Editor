import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type {
  BackupEntry,
  GeoCategory,
  GeoCategoryPage,
  GeoKind,
  GeoMatchAnswer,
  GeoStatus,
  Profile,
  ProfileInboundDetail,
  RealityProbeResult,
  SquadInfo,
  WarpAccount,
  XrayTestResult,
} from './types'

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

export function useSquads() {
  return useQuery({
    queryKey: ['squads'],
    queryFn: () => apiFetch<{ squads: SquadInfo[] }>('/api/squads').then((r) => r.squads),
    staleTime: 60_000,
  })
}

export function useProfileInbounds(uuid: string) {
  return useQuery({
    queryKey: ['profiles', uuid, 'inbounds'],
    queryFn: () =>
      apiFetch<{ inbounds: ProfileInboundDetail[] }>(`/api/profiles/${uuid}/inbounds`).then(
        (r) => r.inbounds,
      ),
    staleTime: 60_000,
  })
}

export function useRealityKeypair() {
  return useMutation({
    mutationFn: () =>
      apiFetch<{ privateKey: string; publicKey: string }>('/api/tools/reality-keypair', {
        method: 'POST',
      }),
  })
}

export function useWarpAccount() {
  return useMutation({
    mutationFn: () =>
      apiFetch<WarpAccount>('/api/tools/warp-account', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  })
}

export function useRealityPublicKey() {
  return useMutation({
    mutationFn: (privateKey: string) =>
      apiFetch<{ publicKey: string }>('/api/tools/reality-public-key', {
        method: 'POST',
        body: JSON.stringify({ privateKey }),
      }),
  })
}

export function useBackups(uuid: string, enabled = true) {
  return useQuery({
    queryKey: ['profiles', uuid, 'backups'],
    queryFn: () =>
      apiFetch<{ backups: BackupEntry[] }>(`/api/profiles/${uuid}/backups`).then((r) => r.backups),
    enabled,
  })
}

export function useGeoStatus() {
  return useQuery({
    queryKey: ['geo'],
    queryFn: () => apiFetch<GeoStatus>('/api/geo'),
    staleTime: 60_000,
  })
}

export function useGeoCategories(kind: GeoKind, enabled = true) {
  return useQuery({
    queryKey: ['geo', kind, 'categories'],
    queryFn: () =>
      apiFetch<{ categories: GeoCategory[] }>(`/api/geo/${kind}/categories`).then(
        (r) => r.categories,
      ),
    enabled,
    // База на диске сама не меняется — перезапрашивать её при каждом открытии незачем
    staleTime: 60_000,
    retry: false,
  })
}

export function useGeoCategory(
  kind: GeoKind,
  code: string | null,
  params: { q: string; offset: number },
) {
  return useQuery({
    queryKey: ['geo', kind, 'category', code, params.q, params.offset],
    queryFn: () => {
      const query = new URLSearchParams({
        q: params.q,
        offset: String(params.offset),
        limit: '200',
      })
      return apiFetch<GeoCategoryPage>(
        `/api/geo/${kind}/categories/${encodeURIComponent(code!)}?${query.toString()}`,
      )
    },
    enabled: code !== null,
    retry: false,
  })
}

export function useSaveGeoUrls() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (urls: { geositeUrl?: string; geoipUrl?: string }) =>
      apiFetch<GeoStatus>('/api/geo', { method: 'PUT', body: JSON.stringify(urls) }),
    onSuccess: (status) => qc.setQueryData(['geo'], status),
  })
}

export function useUpdateGeo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<GeoStatus>('/api/geo/update', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: (status) => {
      qc.setQueryData(['geo'], status)
      // Вердикты трассировки посчитаны по старой базе — пересчитываем
      qc.invalidateQueries({ queryKey: ['geo-match'] })
    },
  })
}

export function useXrayTest() {
  return useMutation({
    mutationFn: (config: unknown) =>
      apiFetch<XrayTestResult>('/api/tools/xray-test', {
        method: 'POST',
        body: JSON.stringify({ config }),
      }),
  })
}

export function useRealityProbe() {
  return useMutation({
    mutationFn: (input: { target: string; serverNames: string[] }) =>
      apiFetch<RealityProbeResult>('/api/tools/reality-target', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}

/** Ответы geo-базы для набора ключей из правил. null или пустые keys — запрос не идёт. */
export function useGeoMatch(input: { domain?: string; ip?: string; keys: string[] } | null) {
  const keys = input?.keys ?? []
  return useQuery({
    queryKey: ['geo-match', input?.domain ?? null, input?.ip ?? null, [...keys].sort()],
    queryFn: () =>
      apiFetch<GeoMatchAnswer>('/api/tools/geo/match', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    enabled: input !== null && keys.length > 0,
    staleTime: 60_000,
  })
}

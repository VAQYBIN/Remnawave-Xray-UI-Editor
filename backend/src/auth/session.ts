import type { FastifyRequest } from 'fastify'

export const SESSION_COOKIE = 'xui_session'

export function isAuthenticated(req: FastifyRequest, ttlSeconds: number): boolean {
  const raw = req.cookies[SESSION_COOKIE]
  if (!raw) return false
  const { valid, value } = req.unsignCookie(raw)
  if (!valid || !value) return false
  const issuedAt = Number(value)
  if (!Number.isFinite(issuedAt)) return false
  return Date.now() - issuedAt < ttlSeconds * 1000
}

/**
 * HTTP middleware that authenticates every request via the session store.
 * On success, attaches `req.userId`. On failure, returns 401.
 */

import { getSession, type SessionStore } from '../auth/session.js'

export interface AuthedRequest {
  method: string
  url: string
  headers: Record<string, string>
  userId?: string
}

export async function authMiddleware(
  store: SessionStore,
  req: AuthedRequest,
): Promise<AuthedRequest | { status: 401; message: string }> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? ''
  const session = getSession(store, token)
  if (!session) {
    return { status: 401, message: 'invalid or expired token' }
  }
  return { ...req, userId: session.userId }
}

export function routeNotFound(url: string): { status: 404; message: string } {
  return { status: 404, message: `no route for ${url}` }
}

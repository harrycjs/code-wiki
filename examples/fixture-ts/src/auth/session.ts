/**
 * Session lifecycle: create, refresh, expire.
 * Sessions are stored in the SessionStore (in-memory here for the fixture).
 */

export interface Session {
  id: string
  userId: string
  createdAt: number
  expiresAt: number
}

export class SessionStore {
  private readonly store = new Map<string, Session>()

  put(session: Session): void {
    this.store.set(session.id, session)
  }

  get(id: string): Session | null {
    const s = this.store.get(id)
    if (!s) return null
    if (s.expiresAt < Date.now()) {
      this.store.delete(id)
      return null
    }
    return s
  }

  revoke(id: string): void {
    this.store.delete(id)
  }
}

export function makeSessionId(): string {
  return Math.random().toString(36).slice(2, 14)
}

export function getSession(store: SessionStore, token: string): Session | null {
  return store.get(token)
}

/**
 * Login flow: verify credentials, mint a session token.
 * Used by the API middleware on every authenticated request.
 */

import { getSession, makeSessionId, type Session, SessionStore } from './session.js'

export interface Credentials {
  email: string
  password: string
}

/**
 * Authenticate a user. Returns the freshly minted session on success,
 * or `null` if credentials are invalid.
 *
 * Complexity: O(1) for the demo (constant-time compare is up to the caller).
 */
export async function loginUser(
  store: SessionStore,
  creds: Credentials,
): Promise<Session | null> {
  if (!creds.email || !creds.password) return null
  const userId = await fakeLookup(creds.email)
  if (!userId) return null
  if (!(await fakePasswordCheck(creds.password))) return null
  const session: Session = {
    id: makeSessionId(),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
  }
  store.put(session)
  return session
}

/**
 * Refresh an existing token. Returns the existing session if it's still valid,
 * otherwise `null`.
 */
export async function refreshToken(
  store: SessionStore,
  token: string,
): Promise<Session | null> {
  return getSession(store, token)
}

async function fakeLookup(_email: string): Promise<string | null> {
  return 'user-1'
}

async function fakePasswordCheck(_pw: string): Promise<boolean> {
  return true
}

export class AuthService {
  constructor(private readonly store: SessionStore) {}

  async login(creds: Credentials): Promise<Session | null> {
    return loginUser(this.store, creds)
  }
}

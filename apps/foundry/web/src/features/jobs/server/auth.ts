/**
 * Node-only. Bearer-token checks shared by the server routes: the forge
 * container's per-job callback and the trigger API's install-wide token.
 *
 * Both compare in constant time — the routes listen on the LAN (the dev server
 * binds 0.0.0.0 so containers can reach it), so a timing oracle on the secret
 * would be a real leak rather than a theoretical one.
 */
import { timingSafeEqual } from 'node:crypto'
import { readFoundryEnv } from './foundry-env'

/** `Authorization: Bearer <token>` against an expected secret. */
export function tokenMatches(expected: string, header: string | null): boolean {
  const got = header?.replace(/^Bearer\s+/i, '') ?? ''
  const a = Buffer.from(expected)
  const b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The trigger API's secret: `foundry auth --api` writes it to the shared
 * ~/.config/liamai/env (Pensieve sends points with it),
 * read fresh per request like every other credential there so a rotation
 * needs no restart. `process.env` is the fallback for headless setups and
 * tests. Undefined means the API is not configured — and stays shut.
 */
export async function apiToken(): Promise<string | undefined> {
  const cred = await readFoundryEnv()
  return cred.FOUNDRY_API_TOKEN ?? process.env.FOUNDRY_API_TOKEN ?? undefined
}

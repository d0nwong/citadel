/** The slice of vitest the persistence conformance suite uses, over `bun:test`. See preload.ts. */
import { it as bunIt, describe, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'

class SkipSignal extends Error {}

export interface TestContext {
  skip: (reason?: string) => never
}

/** A case that calls `ctx.skip()` ends there and counts as passed — bun has no runtime skip. */
export const it = (name: string, fn: (ctx: TestContext) => unknown) =>
  bunIt(name, async () => {
    try {
      await fn({
        skip: (reason) => {
          throw new SkipSignal(reason)
        },
      })
    } catch (e) {
      if (!(e instanceof SkipSignal)) throw e
    }
  })

export const test = it
export { describe, expect, beforeAll, afterAll, beforeEach, afterEach }

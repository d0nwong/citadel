/**
 * `bun test` preload. `@tanstack/ai-persistence/testkit`'s conformance suite is written
 * for vitest and calls `ctx.skip()` inside a case for stores a backend declares skipped.
 * Bun aliases every `vitest` import to `bun:test` before plugins see it, and bun's test
 * callback carries no such context — so the suite would fail on exactly the cases it
 * means to skip. This rewrites the suite's one `from 'vitest'` to the shim next door,
 * which is `bun:test` plus an `it` whose callback gets a `skip()`.
 */
import { plugin } from 'bun'

const shim = new URL('./vitest-shim.ts', import.meta.url).pathname

plugin({
  name: 'vitest-conformance-shim',
  setup(build) {
    build.onLoad({ filter: /@tanstack\/ai-persistence\/dist\/esm\/testkit\/conformance\.js$/ }, async (args) => ({
      contents: (await Bun.file(args.path).text()).replace(/from\s+['"]vitest['"]/g, `from ${JSON.stringify(shim)}`),
      loader: 'js',
    }))
  },
})

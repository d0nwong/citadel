import { defineConfig, isRunnableDevEnvironment } from 'vite'
import type { PluginOption, ViteDevServer } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Boot kick for the ready-ticket scanner (LIA-52). The app has no server entry
 * point of its own — TanStack Start only wakes on requests — so this is where
 * "runs while the dev server is up, UI open or not" can actually start.
 * Gated off unless FOUNDRY_SCANNER=1 (web/.env reaches process.env the same
 * way DATABASE_URL does). The module is loaded through the SSR environment,
 * which may be a second module graph beside the request handlers' — harmless
 * (at worst a second pg pool), because the scanner keeps its interval state on
 * globalThis, the same defence it needs against HMR re-execution anyway.
 */
const scannerBoot = (): PluginOption => ({
  name: 'foundry-scanner-boot',
  apply: 'serve',
  configureServer(server: ViteDevServer) {
    if (process.env.FOUNDRY_SCANNER !== '1') return
    server.httpServer?.once('listening', () => {
      const entry = '/src/features/scanner/server/scanner.ts'
      const ssr = server.environments.ssr
      const load = isRunnableDevEnvironment(ssr) ? ssr.runner.import(entry) : server.ssrLoadModule(entry)
      void load
        .then((m) => (m as { startScanner: () => void }).startScanner())
        .catch((e: unknown) => console.error('[scanner] failed to start:', e))
    })
  },
})

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // Vite rejects unrecognised Host headers as DNS-rebinding protection.
    // `tailscale serve` reaches the dev server under a MagicDNS name, and a
    // forge container calls back via host.docker.internal — allow exactly
    // those rather than `true`, so the protection holds for everything else.
    allowedHosts: ['.ts.net', 'host.docker.internal'],
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact(), scannerBoot()],
})

export default config

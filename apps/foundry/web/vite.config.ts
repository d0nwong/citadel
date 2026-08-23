import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // Vite rejects unrecognised Host headers as DNS-rebinding protection.
    // `tailscale serve` reaches the dev server under a MagicDNS name, so allow
    // that suffix — a leading dot matches any host under it. Scoped to .ts.net
    // rather than `true` so the protection still holds for everything else.
    allowedHosts: ['.ts.net'],
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config

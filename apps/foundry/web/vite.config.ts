import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // Vite rejects unrecognised Host headers as DNS-rebinding protection.
    // `tailscale serve` reaches the dev server under a MagicDNS name, and a
    // forge container calls back via host.docker.internal — allow exactly
    // those rather than `true`, so the protection holds for everything else.
    allowedHosts: ['.ts.net', 'host.docker.internal'],
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config

import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // `tailscale serve` and a container calling back both arrive under non-localhost
    // Host headers; allow exactly those so DNS-rebinding protection holds elsewhere.
    allowedHosts: ['.ts.net', 'host.docker.internal'],
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
})

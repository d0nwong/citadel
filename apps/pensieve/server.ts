/**
 * Production entry — `bun server.ts` after `bun run build`.
 * Static assets come straight off dist/client (immutable, hashed); everything else goes
 * to the TanStack Start handler in dist/server/server.js.
 */
import { extname, join } from "node:path";
import server from "./dist/server/server.js";

const CLIENT_DIR = join(import.meta.dir, "dist/client");
const PORT = Number(process.env.PORT ?? 3778);

Bun.serve({
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && extname(url.pathname)) {
      const file = Bun.file(join(CLIENT_DIR, url.pathname));
      if (await file.exists()) {
        const immutable = url.pathname.startsWith("/assets/");
        return new Response(file, {
          headers: {
            "cache-control": immutable
              ? "public, max-age=31536000, immutable"
              : "public, max-age=300",
          },
        });
      }
    }
    return server.fetch(req);
  },
  hostname: "0.0.0.0",
  // Ask streams for minutes with quiet stretches (a long generation, a slow tool); Bun's
  // default idleTimeout (10 s) would close the socket and the page would show
  // "Stream response body read failed". 0 disables it.
  idleTimeout: 0,
  port: PORT,
});

console.log(
  `pensieve · http://localhost:${PORT} · workspace ${process.env.WORKSPACE_DIR ?? "~/git/citadel-data"}`
);

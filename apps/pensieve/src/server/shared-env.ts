/**
 * Node-only. The shared credentials file — `~/.config/liamai/env`, `KEY=value` lines, mode
 * 600, written one key at a time by whichever bootstrap or `foundry auth` runs (argus
 * `PLAN.md`, "Shared credentials file"). It holds `SLACK_TOKEN`, `LINEAR_API_KEY` and
 * `FOUNDRY_API_TOKEN`; each reader takes the one key it needs and exports nothing.
 *
 * Its own module rather than a corner of `foundry.ts` because both outbound clients read
 * it, and `foundry.ts` fixes `FOUNDRY_URL` at module load: importing it for this would
 * pin that value from whichever module happened to pull the chain in first.
 *
 * The path is resolved per call, not at module load, for the same reason the tokens are
 * read per request — a value fixed at import time belongs to whichever module pulled this
 * one in first, which under `bun test` (one module registry for every file) is not the one
 * that set `LIAMAI_ENV`.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const sharedEnvFile = () =>
  process.env.LIAMAI_ENV || join(homedir(), ".config", "liamai", "env");

/** `KEY=value` lines, the shape `foundry auth` writes. No file is an empty map. */
export async function readSharedEnv(
  file = sharedEnvFile()
): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  try {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) {
        out[m[1]] = m[2];
      }
    }
  } catch {
    /* absent — the caller reports "not configured" */
  }
  return out;
}

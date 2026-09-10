/**
 * Node-only. The one way Pensieve writes the workspace: it runs `bun scripts/argus.ts
 * <verb> … --json` inside WORKSPACE_DIR and reads the JSON the verb prints. Nothing else
 * in this app touches a ledger or a state file. A refusal from argus's validator comes
 * back as data (`ok: false`, its problems), never as a thrown error, so the page can show
 * the sentence the user needs; a process that will not start or hangs comes back the
 * same way with `error` set.
 */

import { join } from "node:path";
import { WORKSPACE_DIR } from "./workspace";

export const ARGUS_SCRIPT = "scripts/argus.ts";
export const ARGUS_TIMEOUT_MS = 30_000;

export type ArgusResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; problems?: { path: string; rule: string }[]; error?: string };

export interface ArgusOptions {
  cwd?: string;
  timeoutMs?: number;
}

/** run one verb; `args` are passed as given, `--json` is added */
export async function argus<T = Record<string, unknown>>(
  verb: string,
  args: string[] = [],
  opts: ArgusOptions = {}
): Promise<ArgusResult<T>> {
  const cwd = opts.cwd ?? WORKSPACE_DIR;
  const timeout = opts.timeoutMs ?? ARGUS_TIMEOUT_MS;
  const started = start(
    ["bun", join(cwd, ARGUS_SCRIPT), verb, ...args, "--json"],
    cwd
  );
  if ("error" in started) {
    return {
      error: `argus ${verb} could not start: ${started.error}`,
      ok: false,
    };
  }
  const { proc } = started;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  if (timedOut) {
    return {
      error: `argus ${verb} took longer than ${Math.round(timeout / 1000)} s`,
      ok: false,
    };
  }
  const last = out.trim().split("\n").filter(Boolean).at(-1);
  if (last) {
    try {
      const parsed = JSON.parse(last) as ArgusResult<T>;
      if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
        return parsed;
      }
    } catch {
      // fall through to the exit code
    }
  }
  if (code === 0) {
    return { ok: true } as ArgusResult<T>;
  }
  const lastErr = err.trim().split("\n").filter(Boolean).at(-1);
  return { error: lastErr ?? `argus ${verb} exited ${code}`, ok: false };
}

type Started = { proc: ReturnType<typeof spawnPiped> } | { error: string };

const spawnPiped = (cmd: string[], cwd: string) =>
  Bun.spawn(cmd, { cwd, stderr: "pipe", stdout: "pipe" });

function start(cmd: string[], cwd: string): Started {
  try {
    return { proc: spawnPiped(cmd, cwd) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** the sentence a page shows for a result that did not land */
export function argusNote(r: ArgusResult): string | null {
  if (r.ok) {
    return null;
  }
  if (r.problems?.length) {
    return r.problems.map((p) => `${p.path}: ${p.rule}`).join("; ");
  }
  return r.error ?? "argus refused, and did not say why";
}

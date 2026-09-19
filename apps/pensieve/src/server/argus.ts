/**
 * Node-only. The one way Pensieve writes the workspace: it runs `bun scripts/argus.ts
 * <verb> … --json` from ARGUS_DIR against WORKSPACE_DIR (passed as ARGUS_ROOT) and reads the JSON the verb prints. Nothing else
 * in this app touches a ledger or a state file. A refusal from argus's validator comes
 * back as data (`ok: false`, its problems), never as a thrown error, so the page can show
 * the sentence the user needs; a process that will not start or hangs comes back the
 * same way with `error` set.
 *
 * `node:child_process`, not `Bun.spawn`: the dev server renders through Vite's Node
 * runtime, where `Bun` is not defined, and the tests run under bun, where both exist.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { ARGUS_DIR, WORKSPACE_DIR } from "./workspace";

export const ARGUS_SCRIPT = "scripts/argus.ts";
export const ARGUS_TIMEOUT_MS = 30_000;

export type ArgusResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; problems?: { path: string; rule: string }[]; error?: string };

export interface ArgusOptions {
  /** argus's code, where `scripts/argus.ts` is; `cwd` when that is given, else ARGUS_DIR */
  argusDir?: string;
  /** the data the verb reads and writes, passed as ARGUS_ROOT; WORKSPACE_DIR by default */
  cwd?: string;
  /** extra environment for the run, over `process.env` and `ARGUS_ROOT` — e.g. `ARGUS_ORIGIN` for a conversation's own commits */
  env?: Record<string, string>;
  timeoutMs?: number;
}

interface Ran {
  code: number | null;
  err: string;
  out: string;
  startError?: string;
  timedOut: boolean;
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout: number
): Promise<Ran> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let timedOut = false;
    let settled = false;
    const done = (r: Ran) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      done({
        code: null,
        err: "",
        out: "",
        startError: (e as Error).message,
        timedOut: false,
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ code: null, err, out, startError: e.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, err, out, timedOut });
    });
  });
}

/** run one verb; `args` are passed as given, `--json` is added */
export async function argus<T = Record<string, unknown>>(
  verb: string,
  args: string[] = [],
  opts: ArgusOptions = {}
): Promise<ArgusResult<T>> {
  const cwd = opts.cwd ?? WORKSPACE_DIR;
  const code = opts.argusDir ?? opts.cwd ?? ARGUS_DIR;
  const timeout = opts.timeoutMs ?? ARGUS_TIMEOUT_MS;
  const r = await run(
    "bun",
    [join(code, ARGUS_SCRIPT), verb, ...args, "--json"],
    cwd,
    { ...process.env, ARGUS_ROOT: cwd, ...opts.env },
    timeout
  );
  if (r.startError) {
    return {
      error: `argus ${verb} could not start: ${r.startError}`,
      ok: false,
    };
  }
  if (r.timedOut) {
    return {
      error: `argus ${verb} took longer than ${Math.round(timeout / 1000)} s`,
      ok: false,
    };
  }
  const last = r.out.trim().split("\n").filter(Boolean).at(-1);
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
  if (r.code === 0) {
    return { ok: true } as ArgusResult<T>;
  }
  const lastErr = r.err.trim().split("\n").filter(Boolean).at(-1);
  return { error: lastErr ?? `argus ${verb} exited ${r.code}`, ok: false };
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

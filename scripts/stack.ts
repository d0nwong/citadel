#!/usr/bin/env bun
/**
 * stack — the parts of the compose recipes too long for the justfile.
 *
 *   bun scripts/stack.ts preflight   before `just up`: the root .env exists, and no container
 *                                    from another project holds the postgres volume
 *   bun scripts/stack.ts url         the DATABASE_URL for the stack's postgres
 *   bun scripts/stack.ts psql ...    a psql shell in it
 *
 * The recipes run from the repo root, so Bun has loaded the root .env into the environment
 * by the time this runs, and a variable set in the shell wins over it.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

type Env = Record<string, string | undefined>;

/** The stack's postgres as a URL, from POSTGRES_* with the compose defaults. */
export const databaseUrl = (e: Env = process.env) =>
  `postgresql://${e.POSTGRES_USER || "foundry"}:${e.POSTGRES_PASSWORD || "foundry"}@localhost:${e.POSTGRES_PORT || "5432"}/${e.POSTGRES_DB || "foundry"}`;

/** The containers holding `volume` that belong to a compose project other than `project`. */
export function foreignHolders(dockerPs: string, project: string): string[] {
  return dockerPs
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([, p]) => p !== project)
    .map(([name, p]) => `${name} (project ${p || "none"})`);
}

function preflight(e: Env = process.env): number {
  if (!existsSync(join(ROOT, ".env"))) {
    console.error("no .env at the repo root — just bootstrap creates it");
    return 1;
  }
  const volume = e.POSTGRES_VOLUME || "foundry-pgdata";
  const project = e.COMPOSE_PROJECT_NAME || "citadel";
  const ps = Bun.spawnSync(
    ["docker", "ps", "--filter", `volume=${volume}`, "--format", '{{.Names}}\t{{.Label "com.docker.compose.project"}}'],
    { stderr: "pipe", stdout: "pipe" }
  );
  if (ps.exitCode !== 0) {
    console.error(`docker ps failed — is OrbStack running?\n${ps.stderr.toString()}`);
    return 1;
  }
  const holders = foreignHolders(ps.stdout.toString(), project);
  if (holders.length) {
    console.error(
      `the postgres volume ${volume} is in use by ${holders.join(", ")}; two postgres servers on one volume corrupt it. Stop that container first, or point POSTGRES_VOLUME elsewhere.`
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "preflight") process.exit(preflight());
  if (cmd === "url") {
    console.log(databaseUrl());
    process.exit(0);
  }
  if (cmd === "psql") {
    const user = process.env.POSTGRES_USER || "foundry";
    const db = process.env.POSTGRES_DB || "foundry";
    const tty = process.stdin.isTTY ? [] : ["-T"];
    const r = Bun.spawnSync(["docker", "compose", "--env-file", ".env", "exec", ...tty, "postgres", "psql", "-U", user, "-d", db, ...rest], {
      cwd: ROOT,
      stdio: ["inherit", "inherit", "inherit"],
    });
    process.exit(r.exitCode ?? 1);
  }
  console.error("bun scripts/stack.ts preflight|url|psql");
  process.exit(1);
}

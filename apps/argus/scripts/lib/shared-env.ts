/**
 * The shared credentials file — one dotenv for the secrets more than one of the three
 * tools (argus, Foundry, Pensieve) needs, so a token is typed once per machine.
 *
 *   ~/.config/liamai/env      (override the path with LIAMAI_ENV)
 *   KEY=value, one per line, no quotes, mode 600. Keys today: SLACK_TOKEN,
 *   LINEAR_API_KEY, FOUNDRY_API_TOKEN.
 *
 * Same shape and parser as Foundry's ~/.foundry/env (`readFoundryEnv`): a regex per
 * line, anything else ignored, a missing file is `{}`. Scripts read it themselves
 * instead of having it exported into the shell, so no other process — including every
 * Claude session on the machine — inherits the tokens by accident.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SHARED_ENV = process.env.LIAMAI_ENV ?? join(homedir(), ".config/liamai/env");

const LINE = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

/** `KEY=value` lines → object. Blank lines, comments and anything unparseable are skipped. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/** The shared file's contents, or `{}` when it does not exist. */
export function sharedEnv(path: string = SHARED_ENV): Record<string, string> {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

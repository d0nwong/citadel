/**
 * data-flow.md — the curated half.
 *
 * Everything here is hand-written, because none of it is derivable: where a value is
 * passed down from, whether it was normalised on the way in, whether a table sorted after
 * fetching, and why. Three mechanical attempts (forward reachability, upward reachability,
 * property→schema join) all failed to answer those, which is exactly why this file exists.
 *
 * The one hard rule: never restate what `api.md` generates. Prose that duplicates a
 * generated endpoint list drifts silently and becomes confidently wrong. The `reads:` and
 * `writes:` header lines are the deliberate exception — they name endpoints so the
 * generated side can AUDIT the prose (see checkDrift).
 *
 * Format — one section per symbol that `accio` already indexes:
 *
 *   ## taskPriority
 *   aka: priority, importance
 *   surface: task detail side card
 *   reads: GET /api/v1/tasks/{taskId} → data.importance (number, 1–10)
 *   writes: PUT /api/v1/tasks/{taskId} — importance + priority together
 *   editable: drafts only
 *
 *   <prose: the flow, the normalisation, the why>
 */

const METHOD = "(?:GET|POST|PUT|PATCH|DELETE)";

export type Entry = {
  symbol: string;
  /** other words a person might call this — feeds search, closes the UI↔API vocabulary gap */
  aka: string[];
  /** free-form header lines other than aka/reads/writes, e.g. surface, editable */
  meta: [key: string, value: string][];
  reads: string[];
  writes: string[];
  /** the reads/writes lines verbatim, which carry the → property and the caveats */
  readLines: string[];
  writeLines: string[];
  prose: string;
  project: string;
};

const endpointsIn = (line: string) =>
  [...line.matchAll(new RegExp(`\\b(${METHOD})\\s+(/\\S+)`, "g"))].map(m => `${m[1]} ${m[2]}`);

export function parseDataFlow(project: string, text: string): Entry[] {
  const out: Entry[] = [];
  for (const sec of text.split(/^## /m).slice(1)) {
    const nl = sec.indexOf("\n");
    const symbol = (nl === -1 ? sec : sec.slice(0, nl)).trim();
    if (!symbol) continue;
    const body = nl === -1 ? "" : sec.slice(nl + 1);

    const e: Entry = {
      symbol, aka: [], meta: [], reads: [], writes: [],
      readLines: [], writeLines: [], prose: "", project,
    };

    // header lines run until the first blank line; everything after is prose
    const lines = body.split("\n");
    let i = 0;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) break;
      const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (!m) break;
      const [, key, value] = m;
      if (key === "aka") e.aka.push(...value.split(",").map(v => v.trim()).filter(Boolean));
      else if (key === "reads") { e.readLines.push(value); e.reads.push(...endpointsIn(value)); }
      else if (key === "writes") { e.writeLines.push(value); e.writes.push(...endpointsIn(value)); }
      else e.meta.push([key, value]);
    }
    e.prose = lines.slice(i).join("\n").trim();
    out.push(e);
  }
  return out;
}

export type Drift = { project: string; symbol: string; endpoint: string; kind: "reads" | "writes" };

/**
 * Audit the prose against the generated side: an endpoint the docs claim, that nothing in
 * the feature calls any more, is the failure mode hand-written docs always have. Flagging
 * it is what makes the curated half sustainable rather than a liability.
 *
 * Only this direction is checked. The reverse — an endpoint called but undocumented — is
 * not drift; most endpoints do not deserve prose.
 */
export function checkDrift(entries: Entry[], calledOps: Set<string>): Drift[] {
  const drift: Drift[] = [];
  const normalise = (s: string) => s.replace(/\{[^}]*\}/g, "{p}").replace(/\/+$/, "");
  const called = new Set([...calledOps].map(normalise));
  for (const e of entries) {
    for (const [kind, list] of [["reads", e.reads], ["writes", e.writes]] as const)
      for (const ep of list)
        if (!called.has(normalise(ep)))
          drift.push({ project: e.project, symbol: e.symbol, endpoint: ep, kind });
  }
  return drift;
}

/** Everything a person might type to reach this entry. */
export const entryText = (e: Entry) =>
  [e.symbol, e.symbol.replace(/([a-z0-9])([A-Z])/g, "$1 $2"), ...e.aka,
   ...e.meta.map(([, v]) => v)].join(" ");

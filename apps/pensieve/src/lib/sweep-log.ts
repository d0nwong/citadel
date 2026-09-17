/**
 * A sweep tick's log, as the loop tees it: Claude's stream-json, one event per line, among the
 * loop's own lines. Each event becomes what it was — the model's text, a tool call, a tool's
 * failure, the closing result; a line that is not an event is kept as it is.
 */

interface ContentBlock {
  content?: unknown;
  input?: unknown;
  is_error?: boolean;
  name?: string;
  text?: string;
  type: string;
}

interface StreamEvent {
  duration_ms?: number;
  is_error?: boolean;
  message?: { content?: ContentBlock[] };
  num_turns?: number;
  result?: unknown;
  subtype?: string;
  total_cost_usd?: number;
  type?: string;
}

export type Entry =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "error"; text: string }
  | { kind: "result"; ok: boolean; text: string; meta: string }
  | { kind: "raw"; text: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The one argument that says what a tool call did: a command, a path, a pattern. */
function toolDetail(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }
  const i = input as Record<string, unknown>;
  const pick =
    i.command ??
    i.file_path ??
    i.pattern ??
    i.path ??
    i.url ??
    i.query ??
    i.skill;
  return clip(typeof pick === "string" ? pick : JSON.stringify(i), 240);
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((c: { text?: unknown } | null) =>
        typeof c?.text === "string" ? c.text : ""
      )
      .join("\n");
  }
  return "";
}

function blockEntry(c: ContentBlock): Entry | null {
  if (c.type === "text" && c.text?.trim()) {
    return { kind: "text", text: c.text.trim() };
  }
  if (c.type === "tool_use") {
    return {
      detail: toolDetail(c.input),
      kind: "tool",
      name: c.name ?? "tool",
    };
  }
  if (c.type === "tool_result" && c.is_error) {
    return { kind: "error", text: clip(toolResultText(c.content), 600) };
  }
  return null;
}

function resultEntry(ev: StreamEvent): Entry {
  const meta = [
    typeof ev.duration_ms === "number" &&
      `${Math.round(ev.duration_ms / 60_000)}m`,
    typeof ev.num_turns === "number" && `${ev.num_turns} turns`,
    typeof ev.total_cost_usd === "number" && `$${ev.total_cost_usd.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    kind: "result",
    meta,
    ok: !ev.is_error && ev.subtype === "success",
    text: typeof ev.result === "string" ? ev.result : (ev.subtype ?? ""),
  };
}

function eventEntries(ev: StreamEvent): Entry[] {
  if (ev.type === "result") {
    return [resultEntry(ev)];
  }
  if (ev.type !== "assistant" && ev.type !== "user") {
    return [];
  }
  return (ev.message?.content ?? [])
    .map(blockEntry)
    .filter((e): e is Entry => e !== null);
}

export function parseLog(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      out.push(...eventEntries(JSON.parse(line) as StreamEvent));
    } catch {
      out.push({ kind: "raw", text: line });
    }
  }
  return out;
}

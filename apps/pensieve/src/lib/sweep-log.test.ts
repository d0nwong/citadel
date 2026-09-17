import { expect, test } from "bun:test";
import { parseLog } from "./sweep-log";

test("turns stream-json events into entries and keeps other lines raw", () => {
  const log = [
    "2026-09-17T08:00:00Z sweep: cloning x into y",
    JSON.stringify({ subtype: "init", type: "system" }),
    JSON.stringify({
      message: {
        content: [
          { text: "Pulling the batch.", type: "text" },
          {
            input: { command: "bun scripts/argus.ts pull" },
            name: "Bash",
            type: "tool_use",
          },
        ],
      },
      type: "assistant",
    }),
    JSON.stringify({
      message: {
        content: [{ content: "boom", is_error: true, type: "tool_result" }],
      },
      type: "user",
    }),
    JSON.stringify({
      duration_ms: 180_000,
      is_error: false,
      num_turns: 12,
      result: "Swept 3 features.",
      subtype: "success",
      total_cost_usd: 0.5,
      type: "result",
    }),
  ].join("\n");
  expect(parseLog(log)).toEqual([
    { kind: "raw", text: "2026-09-17T08:00:00Z sweep: cloning x into y" },
    { kind: "text", text: "Pulling the batch." },
    { detail: "bun scripts/argus.ts pull", kind: "tool", name: "Bash" },
    { kind: "error", text: "boom" },
    {
      kind: "result",
      meta: "3m · 12 turns · $0.50",
      ok: true,
      text: "Swept 3 features.",
    },
  ]);
});

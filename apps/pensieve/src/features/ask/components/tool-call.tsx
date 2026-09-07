/**
 * One collapsed block per harness tool call (AC1). The harness's tools come through as
 * tool-call parts named `Read`, `Grep`, `Bash`, `mcp__linear__get_issue`, …; the UI kit
 * dispatches those to `toolsComponents[name]` only (a fallback part never sees a tool
 * call), so every name that can appear is registered against this one block. A matched
 * tool result reaches it as `result`; only an orphan result reaches the `toolResult` part.
 */
import type { ToolProps } from "@tanstack/ai-react/ui";
import { Tool, ToolContent, ToolHeader, ToolInput } from "#/components/ai/tool";
import { ASK_TOOL_PART_NAMES, PROPOSE_DECISION } from "#/lib/ask-tools";
import { cn } from "#/lib/utils";
import {
  parseArguments,
  toolResultText,
  toolSummary,
} from "../lib/tool-summary";
import type { Opts } from "../model/chat-options";
import { DecisionCard } from "./decision-card";

const OUTPUT_CAP = 6000;

/** Text output as text (a file the session read, a grep listing); anything else as JSON. */
export function Output({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const shown =
    text.length > OUTPUT_CAP
      ? `${text.slice(0, OUTPUT_CAP)}\n… ${text.length - OUTPUT_CAP} more characters`
      : text;
  return (
    <pre
      className={cn(
        "overflow-x-auto whitespace-pre-wrap rounded-md bg-secondary p-2 font-mono text-sm",
        className
      )}
    >
      {shown}
    </pre>
  );
}

/** The header names the tool and what it was about; the body is the input and, once there, the output. */
export function ToolCall({ part, result }: ToolProps<Opts>) {
  const input: unknown = part.input ?? parseArguments(part.arguments);
  const summary = toolSummary(part.name, input);
  const state = result
    ? result.state === "error"
      ? "error"
      : "output-complete"
    : part.state;
  const output = result
    ? (result.error ?? toolResultText(result.content))
    : part.output;
  return (
    <Tool>
      <ToolHeader
        className="font-mono"
        state={state}
        title={summary ? `${part.name} · ${summary}` : part.name}
      />
      <ToolContent>
        <ToolInput input={input ?? part.arguments} />
        {output !== undefined && output !== "" && <Output value={output} />}
      </ToolContent>
    </Tool>
  );
}

/**
 * The adapter's allowlist (the Linear read tools included), plus every name a run can
 * still call and be denied on (the denial arrives as a result on the same part). Anything
 * else warns in dev and renders nothing. The one exception to the collapsed block is the
 * bridged `propose_decision`, whose part is the verdict card (LIA-111).
 */
export const toolsComponents: Record<string, typeof ToolCall> = {
  ...Object.fromEntries(ASK_TOOL_PART_NAMES.map((n) => [n, ToolCall])),
  [PROPOSE_DECISION]: DecisionCard,
};

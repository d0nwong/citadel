/**
 * What the two proposal cards share (LIA-111's `decision-card`, LIA-113's `ticket-card`).
 *
 * Both render a bridged tool's part: while the call is open there is nothing to show but
 * the tool's name, and a refusal is the tool's own sentence in the same collapsed block any
 * other tool call gets. Only the accepted proposal is a card, and that part is each one's
 * own — a verdict and a drafted issue have nothing in common below this line.
 */

import { Tool, ToolContent, ToolHeader } from "#/components/ai/tool";

/** A non-empty string, or nothing — the shape a value off the wire is trusted in. */
export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;

/** The collapsed block a call that answered nothing usable gets — the shape of any tool call. */
export function Block({
  state,
  title,
  children,
}: {
  state: "input-streaming" | "output-error";
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Tool>
      <ToolHeader className="font-mono" state={state} title={title} />
      {children && <ToolContent>{children}</ToolContent>}
    </Tool>
  );
}

/** A refusal, in the register both cards report one in. */
export function Refusal({ error, tool }: { error: string; tool: string }) {
  return (
    <Block state="output-error" title={tool}>
      <p className="px-2 pb-1 text-sm text-st-hold leading-snug">{error}</p>
    </Block>
  );
}

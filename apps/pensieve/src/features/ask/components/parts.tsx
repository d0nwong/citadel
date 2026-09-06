/** The non-tool parts of an assistant turn: text, thinking, an orphan tool result, and anything unknown. */

import type { PartProps } from "@tanstack/ai-react/ui";
import { useEffect, useState } from "react";
import { MessageContent, MessageResponse } from "#/components/ai/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "#/components/ai/reasoning";
import { Tool, ToolContent, ToolHeader } from "#/components/ai/tool";
import { toolResultText } from "../lib/tool-summary";
import type { Opts } from "../model/chat-options";
import { useChat } from "../model/chat-options";
import { Output } from "./tool-call";

export function TextPart({ part }: PartProps<Opts, "text">) {
  return (
    <MessageContent>
      <MessageResponse>{part.content}</MessageResponse>
    </MessageContent>
  );
}

/** Open while the answer streams, closed once it has finished (and when hydrated from disk). */
export function ThinkingPart({ part }: PartProps<Opts, "thinking">) {
  const chat = useChat();
  const [open, setOpen] = useState(chat.isLoading);
  useEffect(() => {
    if (!chat.isLoading) {
      setOpen(false);
    }
  }, [chat.isLoading]);
  return (
    <Reasoning onOpenChange={setOpen} open={open}>
      <ReasoningTrigger />
      <ReasoningContent>{part.content}</ReasoningContent>
    </Reasoning>
  );
}

/** A result with no call to attach to — the kit hides matched results, they render in the call's block. */
export function OrphanResultPart({ part }: PartProps<Opts, "toolResult">) {
  return (
    <Tool>
      <ToolHeader
        className="font-mono"
        state={part.state}
        title={part.name ?? "result"}
      />
      <ToolContent>
        <Output value={part.error ?? toolResultText(part.content)} />
      </ToolContent>
    </Tool>
  );
}

export function FallbackPart({ part }: PartProps<Opts>) {
  return (
    <details className="text-ink-faint text-sm">
      <summary className="kicker cursor-pointer">{part.type}</summary>
      <pre className="mt-1 overflow-x-auto font-mono text-[11px]">
        {JSON.stringify(part, null, 1)}
      </pre>
    </details>
  );
}

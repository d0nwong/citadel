/**
 * /blocks — scratch page for LIA-101. Renders every vendored chat block with canned
 * content so the token mapping can be eyeballed without a model in the
 * loop: Conversation → Message (user + assistant) → Tool (collapsed + expanded) →
 * Reasoning → Sources → PromptInput. Submitting the prompt echoes it locally.
 * Not in the nav on purpose; LIA-103 replaces it with the real /ask pages.
 */

import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "#/components/ai/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "#/components/ai/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
  preventEmptySubmit,
} from "#/components/ai/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "#/components/ai/reasoning";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "#/components/ai/sources";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "#/components/ai/tool";
import { PageHeader } from "#/components/bits";

export const Route = createFileRoute("/blocks")({
  component: BlocksPage,
});

const ASSISTANT_MARKDOWN = `## What the sweep found

Three landings since the last digest, **one** still unjournaled.

### Landings

1. \`feat(points)\` — send a Needs-you point to Foundry, or ignore it with a reason
2. \`feat(workspace)\` — read every app in the blackboard
3. \`chore\` — rename ai-workspace to argus

| landing | ticket | journaled |
| --- | --- | --- |
| feat(points) | LIA-94 | yes |
| feat(workspace) | — | **no** |
| chore | — | yes |

> The unjournaled landing has no ticket; the journal entry would need one before it can be filed.

\`\`\`ts
const unjournaled = landings.filter((l) => !journal.has(l.sha))
\`\`\`

- [x] read reports/points.json
- [ ] file the missing journal entry
`;

interface Turn {
  from: "user" | "assistant";
  id: number;
  text: string;
}

function BlocksPage() {
  const [turns, setTurns] = useState<Turn[]>([]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    preventEmptySubmit(e);
    if (e.defaultPrevented) {
      return;
    }
    e.preventDefault();
    const form = e.currentTarget;
    const field = form.elements.namedItem("message") as HTMLTextAreaElement;
    const text = field.value.trim();
    setTurns((t) => [
      ...t,
      { id: t.length * 2, from: "user", text },
      { id: t.length * 2 + 1, from: "assistant", text: `You said: _${text}_` },
    ]);
    form.reset();
  };

  return (
    <div className="flex h-[calc(100dvh-5rem)] flex-col">
      <PageHeader
        actions="shadcn.io/ai on Pensieve's tokens"
        title="Chat blocks"
      />

      <Conversation className="min-h-0">
        <ConversationContent className="px-0">
          <Message from="user">
            <MessageContent>
              What did the last sweep find, and is anything unjournaled?
            </MessageContent>
          </Message>

          <Message from="assistant">
            <Tool>
              <ToolHeader state="output-complete" title="read_file" />
              <ToolContent>
                <ToolInput input={{ path: "reports/points.json" }} />
                <ToolOutput output={{ points: 3, needsYou: 1 }} />
              </ToolContent>
            </Tool>
            <Tool defaultOpen>
              <ToolHeader state="output-complete" title="list_landings" />
              <ToolContent>
                <ToolInput input={{ since: "2026-09-01", app: "argus" }} />
                <ToolOutput
                  output={[
                    { sha: "de88991", ticket: "LIA-94" },
                    { sha: "2ef06fe", ticket: null },
                  ]}
                />
              </ToolContent>
            </Tool>
            <Tool>
              <ToolHeader state="input-streaming" title="grep_journal" />
              <ToolContent>
                <ToolInput input={{ pattern: "2ef06fe" }} />
              </ToolContent>
            </Tool>
            <Reasoning>
              <ReasoningTrigger />
              <ReasoningContent>
                Two of three landings carry a ticket. The workspace change has
                none, so I should say so rather than guess one.
              </ReasoningContent>
            </Reasoning>
            <MessageContent>
              <MessageResponse>{ASSISTANT_MARKDOWN}</MessageResponse>
            </MessageContent>
            <Sources>
              <SourcesTrigger count={2} />
              <SourcesContent>
                <Source
                  href="https://linear.app/liamai/issue/LIA-94"
                  title="LIA-94 — points page"
                />
                <Source
                  href="https://github.com/d0nwong/pensieve/pull/1"
                  title="pensieve#1"
                />
              </SourcesContent>
            </Sources>
          </Message>

          {turns.map((t) => (
            <Message from={t.from} key={t.id}>
              <MessageContent>
                {t.from === "assistant" ? (
                  <MessageResponse>{t.text}</MessageResponse>
                ) : (
                  t.text
                )}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput className="mt-4" onSubmit={submit}>
        <PromptInputTextarea
          name="message"
          placeholder="Ask about the argus checkout…"
        />
        <PromptInputToolbar>
          <PromptInputTools>
            <span className="kicker px-2">claude-code · local</span>
          </PromptInputTools>
          <PromptInputSubmit status="ready" />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}

import type { LayoutProps } from "@tanstack/ai-react/ui";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "#/components/ai/conversation";
import { useAskContext } from "../model/ask-context";
import type { Opts } from "../model/chat-options";
import { useChat } from "../model/chat-options";
import { useFinishReason, useRanHere } from "../model/finish-reason";
import type { AskInput } from "./input";

/** The conversation, the run's end state under it, and the composer. */
export function AskLayout({
  Messages,
  Queue,
  Interrupts,
  Input,
}: LayoutProps<Opts, typeof AskInput>) {
  const chat = useChat();
  const empty = chat.messages.length === 0;
  const { threadId, finishReason, lastError } = useAskContext();
  const finish = useFinishReason(threadId, finishReason);
  // The stored error stands until a run happens on this page; then the hook's own error does.
  const ranHere = useRanHere(threadId);
  const error =
    chat.error?.message ??
    (ranHere || chat.isLoading ? undefined : lastError?.message);
  return (
    <>
      <Conversation className="min-h-0">
        <ConversationContent className="px-0">
          {empty ? (
            <ConversationEmptyState
              description="Claude Code with the argus checkout open, read-only. Ask what is on you, what a rule says and who settled it, where a feature lives."
              title="🐶 Ask argus"
            />
          ) : (
            <Messages />
          )}
          <Queue />
          <Interrupts />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {error && (
        <p
          className="mt-3 whitespace-pre-wrap text-sm text-st-hold"
          role="alert"
        >
          {error}
        </p>
      )}
      {finish === "length" && !chat.isLoading && (
        <p className="mt-3 text-muted-foreground text-sm" role="status">
          Stopped at the turn limit before it was done. Ask it to continue — the
          session picks up where it left off.
        </p>
      )}
      <Input />
    </>
  );
}

/**
 * /ask — every stored conversation, newest first, titled by its first question (AC5), and
 * the way to start one: mint a thread id here, and the conversation page does the rest.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { Empty, PageHeader } from "#/components/bits";
import { Button } from "#/components/ui/button";
import { newThreadId } from "#/features/ask";
import { listConversations } from "#/lib/api";
import { prettyStamp } from "#/lib/utils";

export const Route = createFileRoute("/ask/")({
  loader: () => listConversations(),
  component: AskListPage,
});

function AskListPage() {
  const conversations = Route.useLoaderData();
  const navigate = useNavigate();
  const start = () =>
    navigate({ to: "/ask/$id", params: { id: newThreadId() } });
  return (
    <>
      <PageHeader
        aside={
          <Button onClick={start} size="sm">
            <PlusIcon />
            New conversation
          </Button>
        }
        eyebrow="Argus"
        title="Conversations"
      />
      {conversations.length === 0 && (
        <Empty title="No conversations yet">
          Start one and ask what the last sweep found, or where a feature lives.
        </Empty>
      )}
      <ul className="divide-y divide-border">
        {conversations.map((c) => (
          <li key={c.threadId}>
            {/* Phone: the question on two lines with the time under it; from sm up, one row with the time first. */}
            <Link
              className="flex flex-col gap-0.5 rounded-md px-2 py-2 transition-colors hover:bg-accent sm:flex-row sm:items-baseline sm:gap-4"
              params={{ id: c.threadId }}
              to="/ask/$id"
            >
              <span className="mono order-last shrink-0 text-subtle sm:order-none sm:w-36">
                {prettyStamp(c.updatedAt)}
              </span>
              <span className="min-w-0 font-medium text-foreground max-sm:line-clamp-2 sm:truncate">
                {c.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

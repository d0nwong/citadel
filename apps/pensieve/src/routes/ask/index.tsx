/**
 * /ask — every stored conversation, newest first, titled by its first question (AC5), and
 * the way to start one: mint a thread id here, and the conversation page does the rest.
 */
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { MoreHorizontalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Empty, PageHeader } from "#/components/bits";
import { DocLayout } from "#/components/toc";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { newThreadId } from "#/features/ask";
import { discardMessage } from "#/features/ask/lib/discard-message";
import {
  deleteConversation,
  getConversationDiscard,
  listConversations,
} from "#/lib/api";
import { prettyStamp } from "#/lib/utils";

export const Route = createFileRoute("/ask/")({
  staticData: { crumb: "Argus" },
  loader: () => listConversations(),
  component: AskListPage,
});

function AskListPage() {
  const conversations = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const start = () =>
    navigate({ to: "/ask/$id", params: { id: newThreadId() } });
  const remove = async (threadId: string) => {
    const discard = await getConversationDiscard({ data: threadId });
    if (
      // biome-ignore lint/suspicious/noAlert: a native confirm is the intended guard for delete
      !window.confirm(discardMessage(discard))
    ) {
      return;
    }
    await deleteConversation({ data: threadId });
    await router.invalidate();
  };
  return (
    <DocLayout>
      <PageHeader
        actions={
          <Button onClick={start} size="sm">
            <PlusIcon />
            New conversation
          </Button>
        }
        title="Conversations"
      />
      {conversations.length === 0 && (
        <Empty title="No conversations yet">
          Start one and ask what the last sweep found, or where a feature lives.
        </Empty>
      )}
      <ul className="divide-y divide-border">
        {conversations.map((c) => (
          <li className="group flex items-center gap-1" key={c.threadId}>
            {/* Phone: the question on two lines with the time under it; from sm up, one row with the time first. */}
            <Link
              className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-2 transition-colors hover:bg-accent sm:flex-row sm:items-baseline sm:gap-4"
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
            {/* Beside the link, not in it, so opening the menu never opens the conversation.
                Always there on a phone; from sm up it shows on the row's hover or focus. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Conversation actions"
                  className="shrink-0 text-muted-foreground transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 sm:opacity-0"
                  size="icon-sm"
                  variant="ghost"
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-st-hold focus:text-st-hold"
                  onSelect={() => void remove(c.threadId)}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
    </DocLayout>
  );
}

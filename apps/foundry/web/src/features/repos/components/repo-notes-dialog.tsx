import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";
import { MAX_REPO_NOTES, saveRepoNotes } from "../api";
import { repoQueries } from "../queries";
import { cn } from "@/shared/lib/utils";
import type { Repo } from "../types";

const PLACEHOLDER = `Package manager is bun — never npm.
Verify with \`bun run typecheck\` before finishing.
Base new work on staging, not main.
UI goes through the shared components in src/shared/ui.`;

/**
 * Standing instructions for one repo, handed to every job that targets it.
 * Kept in foundry rather than in the checkout on purpose: this is where the
 * preferences go that the repo's own CLAUDE.md cannot carry.
 */
export function RepoNotesDialog({ repo }: { repo: Repo }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(repo.notes);

  const mutation = useMutation({
    mutationFn: (notes: string) => saveRepoNotes({ data: { path: repo.path, notes } }),
    onSuccess: (_result, notes) => {
      qc.invalidateQueries({ queryKey: repoQueries.all });
      toast.success(notes.trim() === "" ? `Notes cleared for ${repo.name}` : `Notes saved for ${repo.name}`);
      setOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hasNotes = repo.notes.trim() !== "";
  const tooLong = draft.length > MAX_REPO_NOTES;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Reopening should show what is stored, not a stale edit.
        if (v) setDraft(repo.notes);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          title={hasNotes ? `Notes for ${repo.name}` : `Add notes for ${repo.name}`}
          className={cn(
            "transition-all hover:text-ember",
            hasNotes ? "text-ember" : "text-txt-faint lg:opacity-0 lg:group-hover:opacity-100",
          )}
        >
          <NotebookPen className="size-3.5" />
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-[calc(100vw-2rem)] gap-0 border-hairline bg-iron-850 p-0 sm:max-w-lg">
        <div className="h-px w-full bg-gradient-to-r from-ember via-ember-deep to-transparent" />
        <DialogHeader className="space-y-1 px-5 pb-5 pt-5 text-left sm:px-6">
          <DialogTitle className="text-[17px] font-bold tracking-tight">Notes · {repo.name}</DialogTitle>
          <DialogDescription className="text-[13px] text-txt-dim">
            Standing instructions for every job on this repo — conventions, the package manager, what to verify with.
            They reach Claude Code as system prompt before it plans.
          </DialogDescription>
        </DialogHeader>

        <div className="border-t border-hairline px-5 py-5 sm:px-6">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={9}
            placeholder={PLACEHOLDER}
            className="resize-none border-iron-700 bg-iron-900 font-mono text-[12.5px] leading-relaxed placeholder:text-txt-faint focus-visible:ring-ember-deep"
          />
          <p className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-txt-faint">
            <span>Never committed — stored with the repo in foundry.</span>
            <span className={cn(tooLong && "text-crack")}>
              {draft.length}/{MAX_REPO_NOTES}
            </span>
          </p>
        </div>

        <DialogFooter className="gap-2 border-t border-hairline bg-iron-900/60 px-5 py-4 sm:px-6">
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            className="h-9 text-[13px] text-txt-dim hover:text-txt"
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate(draft)}
            disabled={mutation.isPending || tooLong || draft === repo.notes}
            className="h-9 gap-2 rounded-md bg-ember px-4 text-[13px] font-semibold text-primary-foreground hover:bg-ember-soft"
          >
            {mutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save notes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Flame, GitBranch, Loader2 } from "lucide-react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { createJob } from "../api";
import { jobQueries } from "../queries";
import { blueprintQueries } from "@/features/blueprints/queries";
import { forgeQueries } from "@/features/forges/queries";
import { repoQueries } from "@/features/repos/queries";

import { cn } from "@/shared/lib/utils";
import { stepsSummary } from "@/features/blueprints/types";
import { localRef, repoLabel } from "@/features/repos/types";
import { shortId } from "../types";
import type { NewJobInput } from "../types";
import type { Repo } from "@/features/repos/types";

// A plain <label>: shadcn's Label ships `text-sm`, which beats `.kicker` in the
// utilities layer and blows the stamped label size out.
const repoLabelOf = (repo: Repo) => repoLabel(localRef(repo));

/** The Select's "no blueprint" row — radix rejects an empty-string value. */
const NO_BLUEPRINT = "none";

const FieldLabel = ({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) => (
  <label htmlFor={htmlFor} className="kicker mb-2 block">
    {children}
  </label>
);

export function NewJobDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [task, setTask] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [blueprintId, setBlueprintId] = useState(NO_BLUEPRINT);

  const { data: repos } = useQuery(repoQueries.list());
  const { data: blueprints } = useQuery(blueprintQueries.list());
  const blueprint = blueprints?.find((b) => b.id === blueprintId);

  const reset = () => {
    setRepo(null);
    setTask("");
    setBaseBranch("");
    setBlueprintId(NO_BLUEPRINT);
  };

  const mutation = useMutation({
    mutationFn: (input: NewJobInput) => createJob({ data: input }),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: jobQueries.all });
      qc.invalidateQueries({ queryKey: forgeQueries.all });
      toast.success(`Job ${shortId(job.id)} queued`, {
        description: `${job.repo.name} → ${job.forge}${job.blueprint ? ` · ${job.blueprint.name}` : ""}`,
      });
      setOpen(false);
      reset();
    },
  });

  const ready = repo !== null && task.trim().length > 3;

  const submit = () => {
    if (!repo || !ready) return;
    mutation.mutate({
      task,
      repo: localRef(repo),
      baseBranch: baseBranch.trim() || repo.defaultBranch,
      // Jobs run in an ephemeral container per job — `forge` names the
      // adapter, and the container itself lands on the job row (LIA-13).
      forge: "orbstack",
      blueprintId: blueprintId === NO_BLUEPRINT ? undefined : blueprintId,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-9 gap-2 rounded-md bg-ember px-4 text-[13px] font-semibold text-primary-foreground shadow-[0_0_20px_-6px_var(--ember)] hover:bg-ember-soft">
          <Flame className="size-4" />
          Ignite
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[92vh] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden border-hairline bg-iron-850 p-0 sm:max-w-xl">
        <div className="h-px w-full bg-gradient-to-r from-ember via-ember-deep to-transparent" />
        <DialogHeader className="space-y-1 px-5 pb-5 pt-5 text-left sm:px-6">
          <DialogTitle className="text-[17px] font-bold tracking-tight">
            Ignite
          </DialogTitle>
          <DialogDescription className="text-[13px] text-txt-dim">
            Claude Code runs the task inside an isolated forge against a local
            repo.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto border-t border-hairline px-5 py-5 sm:px-6">
          <div>
            <FieldLabel>Repository</FieldLabel>
            <Popover open={repoOpen} onOpenChange={setRepoOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={repoOpen}
                  className="h-10 w-full justify-between border-iron-700 bg-iron-900 px-3 font-mono text-[13px] font-normal hover:bg-iron-800"
                >
                  {repo ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-txt">
                        {repoLabelOf(repo)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-txt-faint">
                        <GitBranch className="size-3" />
                        {repo.branch}
                      </span>
                    </span>
                  ) : (
                    <span className="text-txt-faint">Select a local repo…</span>
                  )}
                  <ChevronsUpDown className="size-3.5 shrink-0 text-txt-faint" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[--radix-popover-trigger-width] border-hairline bg-iron-800 p-0"
                align="start"
              >
                {(repos ?? []).length === 0 ? (
                  <div className="space-y-2 px-4 py-5 text-center">
                    <p className="text-[13px] text-txt-dim">
                      No repos added yet.
                    </p>
                    <Link
                      to="/repos"
                      onClick={() => setOpen(false)}
                      className="inline-block font-mono text-[12px] text-ember hover:underline"
                    >
                      Add repos →
                    </Link>
                  </div>
                ) : (
                  <Command className="bg-transparent">
                    <CommandInput
                      placeholder="Search repos…"
                      className="font-mono text-[13px]"
                    />
                    <CommandList>
                      <CommandEmpty className="py-6 text-center text-[13px] text-txt-faint">
                        No repo found.
                      </CommandEmpty>
                      <CommandGroup>
                        {repos?.map((r) => (
                          <CommandItem
                            key={r.path}
                            value={r.path}
                            onSelect={() => {
                              setRepo(r);
                              setBaseBranch(r.defaultBranch);
                              setRepoOpen(false);
                            }}
                            className="gap-2 font-mono text-[13px]"
                          >
                            <Check
                              className={cn(
                                "size-3.5 text-ember",
                                repo?.path === r.path
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <span className="truncate">{r.name}</span>
                            {r.dirty && (
                              <span className="ml-auto text-[10px] text-slag">
                                uncommitted
                              </span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <FieldLabel htmlFor="task">Task</FieldLabel>
            <Textarea
              id="task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
              placeholder="Migrate the test runner from jest to vitest and get CI green"
              className="resize-none border-iron-700 bg-iron-900 text-[13px] leading-relaxed placeholder:text-txt-faint focus-visible:ring-ember-deep"
            />
          </div>

          <div>
            <FieldLabel>Blueprint</FieldLabel>
            <Select value={blueprintId} onValueChange={setBlueprintId}>
              <SelectTrigger className="h-10 w-full border-iron-700 bg-iron-900 font-mono text-[13px] focus-visible:ring-ember-deep">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-hairline bg-iron-800 font-mono text-[13px]">
                <SelectItem value={NO_BLUEPRINT}>
                  none — one step, default model
                </SelectItem>
                {blueprints?.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 truncate font-mono text-[11px] text-txt-faint">
              {blueprint ? (
                stepsSummary(blueprint.steps)
              ) : (
                <>
                  Define multi-step runs on the{" "}
                  <Link
                    to="/blueprints"
                    onClick={() => setOpen(false)}
                    className="text-ember hover:underline"
                  >
                    Blueprints
                  </Link>{" "}
                  page.
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Forge</FieldLabel>
              <div className="flex h-10 items-center rounded-md border border-iron-700 bg-iron-900/60 px-3 font-mono text-[13px] text-txt-dim">
                orbstack
                <span className="ml-2 text-txt-faint">
                  ephemeral, one per job
                </span>
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="base">Base branch</FieldLabel>
              <Input
                id="base"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder={repo?.defaultBranch ?? "main"}
                className="h-10 border-iron-700 bg-iron-900 font-mono text-[13px] placeholder:text-txt-faint focus-visible:ring-ember-deep"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-hairline bg-iron-900/60 px-3.5 py-3">
            <span className="space-y-0.5">
              <span className="block text-[13px] font-medium text-txt">
                Isolated workspace
              </span>
              <span className="block text-[11px] text-txt-faint">
                Every job runs against its own clone — your working tree is
                never touched, and uncommitted changes stay out of the job.
              </span>
            </span>
          </div>
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
            onClick={submit}
            disabled={!ready || mutation.isPending}
            className="h-9 gap-2 bg-ember px-5 text-[13px] font-semibold text-primary-foreground hover:bg-ember-soft disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Flame className="size-4" />
            )}
            Ignite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

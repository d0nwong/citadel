import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Flame, GitBranch, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/shared/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { Textarea } from '@/shared/ui/textarea'
import { createJob } from '../api'
import { jobQueries } from '../queries'
import { forgeQueries } from '@/features/forges/queries'
import { repoQueries } from '@/features/repos/queries'

import { cn } from '@/shared/lib/utils'
import { localRef, repoLabel } from '@/features/repos/types'
import type { NewJobInput } from '../types'
import type { Repo } from '@/features/repos/types'

// A plain <label>: shadcn's Label ships `text-sm`, which beats `.kicker` in the
// utilities layer and blows the stamped label size out.
const repoLabelOf = (repo: Repo) => repoLabel(localRef(repo))

const FieldLabel = ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
  <label htmlFor={htmlFor} className="kicker mb-2 block">
    {children}
  </label>
)

export function NewJobDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [repoOpen, setRepoOpen] = useState(false)
  const [repo, setRepo] = useState<Repo | null>(null)
  const [task, setTask] = useState('')
  const [forge, setForge] = useState('auto')
  const [baseBranch, setBaseBranch] = useState('')
  const [worktree, setWorktree] = useState(true)

  const { data: repos } = useQuery(repoQueries.list())
  const { data: forges } = useQuery(forgeQueries.list())

  const reset = () => {
    setRepo(null)
    setTask('')
    setForge('auto')
    setBaseBranch('')
    setWorktree(true)
  }

  const mutation = useMutation({
    mutationFn: (input: NewJobInput) => createJob({ data: input }),
    onSuccess: (job) => {
      qc.invalidateQueries({ queryKey: jobQueries.all })
      qc.invalidateQueries({ queryKey: forgeQueries.all })
      toast.success(`Job ${job.id} queued`, { description: `${job.repo.name} → ${job.forge}` })
      setOpen(false)
      reset()
    },
  })

  const idleForges = forges?.filter((f) => f.status !== 'stopped') ?? []
  const ready = repo !== null && task.trim().length > 3

  const submit = () => {
    if (!repo || !ready) return
    mutation.mutate({
      task,
      repo: localRef(repo),
      baseBranch: baseBranch.trim() || repo.branch,
      forge: forge === 'auto' ? (idleForges.find((f) => f.status === 'idle')?.name ?? 'bellows') : forge,
      worktree,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-9 gap-2 rounded-md bg-ember px-4 text-[13px] font-semibold text-primary-foreground shadow-[0_0_20px_-6px_var(--ember)] hover:bg-ember-soft">
          <Flame className="size-4" />
          Forge a job
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-xl gap-0 overflow-hidden border-hairline bg-iron-850 p-0 sm:max-w-xl">
        <div className="h-px w-full bg-gradient-to-r from-ember via-ember-deep to-transparent" />
        <DialogHeader className="space-y-1 px-6 pb-5 pt-5 text-left">
          <DialogTitle className="text-[17px] font-bold tracking-tight">Forge a job</DialogTitle>
          <DialogDescription className="text-[13px] text-txt-dim">
            Claude Code runs the task inside an isolated forge against a local repo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 border-t border-hairline px-6 py-5">
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
                      <span className="truncate text-txt">{repoLabelOf(repo)}</span>
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
              <PopoverContent className="w-[--radix-popover-trigger-width] border-hairline bg-iron-800 p-0" align="start">
                {(repos ?? []).length === 0 ? (
                  <div className="space-y-2 px-4 py-5 text-center">
                    <p className="text-[13px] text-txt-dim">No repos added yet.</p>
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
                  <CommandInput placeholder="Search repos…" className="font-mono text-[13px]" />
                  <CommandList>
                    <CommandEmpty className="py-6 text-center text-[13px] text-txt-faint">No repo found.</CommandEmpty>
                    <CommandGroup>
                      {repos?.map((r) => (
                        <CommandItem
                          key={r.path}
                          value={r.path}
                          onSelect={() => {
                            setRepo(r)
                            setBaseBranch(r.branch)
                            setRepoOpen(false)
                          }}
                          className="gap-2 font-mono text-[13px]"
                        >
                          <Check className={cn('size-3.5 text-ember', repo?.path === r.path ? 'opacity-100' : 'opacity-0')} />
                          <span className="truncate">{r.name}</span>
                          {r.dirty && <span className="ml-auto text-[10px] text-slag">uncommitted</span>}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Forge</FieldLabel>
              <Select value={forge} onValueChange={setForge}>
                <SelectTrigger className="h-10 w-full border-iron-700 bg-iron-900 font-mono text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-hairline bg-iron-800">
                  <SelectItem value="auto" className="font-mono text-[13px]">
                    auto — first idle
                  </SelectItem>
                  {idleForges.map((f) => (
                    <SelectItem key={f.name} value={f.name} className="font-mono text-[13px]">
                      {f.name}
                      <span className="ml-2 text-txt-faint">{f.runtimeSummary}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel htmlFor="base">Base branch</FieldLabel>
              <Input
                id="base"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder={repo?.branch ?? 'main'}
                className="h-10 border-iron-700 bg-iron-900 font-mono text-[13px] placeholder:text-txt-faint focus-visible:ring-ember-deep"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-md border border-hairline bg-iron-900/60 px-3.5 py-3">
            <span className="space-y-0.5">
              <span className="block text-[13px] font-medium text-txt">Isolate in a git worktree</span>
              <span className="block text-[11px] text-txt-faint">
                Keeps your working tree untouched while the job runs.
              </span>
            </span>
            <Switch checked={worktree} onCheckedChange={setWorktree} className="data-[state=checked]:bg-ember" />
          </label>
        </div>

        <DialogFooter className="gap-2 border-t border-hairline bg-iron-900/60 px-6 py-4">
          <Button variant="ghost" onClick={() => setOpen(false)} className="h-9 text-[13px] text-txt-dim hover:text-txt">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!ready || mutation.isPending}
            className="h-9 gap-2 bg-ember px-5 text-[13px] font-semibold text-primary-foreground hover:bg-ember-soft disabled:opacity-40"
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4" />}
            Ignite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

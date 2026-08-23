import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderSearch, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { addRepos } from '../api'
import { repoQueries } from '../queries'
import { tilde } from '../types'
import { relative } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'

export function AddReposDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const { data: roots } = useQuery(repoQueries.scanRoots())
  const { data: discovered, isFetching } = useQuery({ ...repoQueries.discovered(), enabled: open })

  const candidates = useMemo(
    () => (discovered ?? []).filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [discovered, filter],
  )
  const selectable = candidates.filter((r) => !r.tracked)
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.path))

  const toggle = (path: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const mutation = useMutation({
    mutationFn: (paths: Array<string>) => addRepos({ data: paths }),
    onSuccess: (_result, paths) => {
      qc.invalidateQueries({ queryKey: repoQueries.all })
      toast.success(`Added ${paths.length} repo${paths.length === 1 ? '' : 's'}`)
      setOpen(false)
      setPicked(new Set())
      setFilter('')
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setPicked(new Set())
          setFilter('')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-9 gap-2 rounded-md bg-ember px-4 text-[13px] font-semibold text-primary-foreground shadow-[0_0_20px_-6px_var(--ember)] hover:bg-ember-soft">
          <Plus className="size-4" />
          Add repos
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[80vh] max-w-xl flex-col gap-0 overflow-hidden border-hairline bg-iron-850 p-0 sm:max-w-xl">
        <div className="h-px w-full bg-gradient-to-r from-ember via-ember-deep to-transparent" />
        <DialogHeader className="space-y-1 px-6 pb-4 pt-5 text-left">
          <DialogTitle className="text-[17px] font-bold tracking-tight">Add repos</DialogTitle>
          <DialogDescription className="text-[13px] text-txt-dim">
            Only the repos you add here can be targeted by a job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-t border-hairline px-6 py-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-txt-faint">
            <FolderSearch className="size-3.5" />
            scanning {roots?.map(tilde).join(', ') ?? '…'}
          </div>
          <div className="flex items-center gap-3">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name…"
              className="h-9 border-iron-700 bg-iron-900 font-mono text-[13px] placeholder:text-txt-faint focus-visible:ring-ember-deep"
            />
            <button
              type="button"
              disabled={selectable.length === 0}
              onClick={() =>
                setPicked((prev) => {
                  const next = new Set(prev)
                  for (const r of selectable) {
                    if (allPicked) next.delete(r.path)
                    else next.add(r.path)
                  }
                  return next
                })
              }
              className="shrink-0 font-mono text-[11px] text-txt-dim transition-colors hover:text-ember disabled:opacity-40"
            >
              {allPicked ? 'clear' : `all ${selectable.length}`}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-hairline">
          {isFetching && !discovered
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="border-b border-hairline px-6 py-3">
                  <Skeleton className="h-6 w-full bg-iron-800" />
                </div>
              ))
            : candidates.map((repo) => {
                const checked = repo.tracked || picked.has(repo.path)
                return (
                  <label
                    key={repo.path}
                    className={cn(
                      'flex items-center gap-3 border-b border-hairline px-6 py-3 transition-colors',
                      repo.tracked ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-iron-800/60',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={repo.tracked}
                      onCheckedChange={() => toggle(repo.path)}
                      className="border-iron-700 data-[state=checked]:border-ember data-[state=checked]:bg-ember data-[state=checked]:text-primary-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px] text-txt">{repo.name}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-txt-faint">
                        {repo.branch} · updated {relative(repo.lastCommit)}
                        {repo.dirty && <span className="ml-2 text-slag">uncommitted</span>}
                      </span>
                    </span>
                    {repo.tracked && <span className="font-mono text-[10px] text-txt-faint">added</span>}
                  </label>
                )
              })}
          {!isFetching && candidates.length === 0 && (
            <p className="px-6 py-10 text-center font-mono text-[12px] text-txt-faint">No repos match.</p>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-hairline bg-iron-900/60 px-6 py-4">
          <span className="mr-auto font-mono text-[11px] text-txt-faint">{picked.size} selected</span>
          <Button variant="ghost" onClick={() => setOpen(false)} className="h-9 text-[13px] text-txt-dim hover:text-txt">
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate([...picked])}
            disabled={picked.size === 0 || mutation.isPending}
            className="h-9 gap-2 bg-ember px-5 text-[13px] font-semibold text-primary-foreground hover:bg-ember-soft disabled:opacity-40"
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add {picked.size > 0 ? picked.size : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

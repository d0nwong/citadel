import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Trash2 } from 'lucide-react'
import { AddReposDialog } from './add-repos-dialog'
import { removeRepo } from '../api'
import { repoQueries } from '../queries'
import { localRef, repoLabel } from '../types'
import { PageHeader } from '@/shared/components/page-header'

export function RepoInventory() {
  const qc = useQueryClient()
  const { data: repos, isLoading } = useQuery(repoQueries.list())

  const remove = useMutation({
    mutationFn: (repoPath: string) => removeRepo({ data: repoPath }),
    onSuccess: () => qc.invalidateQueries({ queryKey: repoQueries.all }),
  })

  return (
    <>
      <PageHeader title="Repos">
        <span className="font-mono text-[11px] text-txt-faint">{repos?.length ?? 0} added</span>
        <AddReposDialog />
      </PageHeader>

      {!isLoading && repos?.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-24">
          <p className="text-[14px] text-txt-dim">No repos added yet.</p>
          <p className="font-mono text-[12px] text-txt-faint">Add one before forging a job.</p>
        </div>
      )}

      {repos?.map((repo) => (
        <div
          key={repo.path}
          className="group relative flex flex-col gap-1.5 border-b border-hairline bg-iron-900 px-4 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_200px_110px_40px] lg:items-center lg:gap-4 lg:px-6 lg:py-3.5"
        >
          <span className="min-w-0">
            <span className="block truncate pr-8 text-[13.5px] font-medium text-txt lg:pr-0">{repo.name}</span>
            <span className="mt-0.5 block truncate font-mono text-[11px] text-txt-faint">
              {repoLabel(localRef(repo))}
            </span>
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 lg:contents">
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-txt-dim lg:w-auto">
            <GitBranch className="size-3 shrink-0 text-txt-faint" />
            <span className="truncate">{repo.branch}</span>
          </span>
          <span className="font-mono text-[11px]">
            {repo.dirty ? <span className="text-slag">uncommitted</span> : <span className="text-txt-faint">clean</span>}
          </span>
          </span>
          <button
            type="button"
            onClick={() => remove.mutate(repo.path)}
            title={`Remove ${repo.name}`}
            className="absolute right-4 top-3 text-txt-faint transition-all hover:text-crack lg:static lg:justify-self-end lg:opacity-0 lg:group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </>
  )
}

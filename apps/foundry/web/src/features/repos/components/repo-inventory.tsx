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
          className="group grid grid-cols-[minmax(0,1fr)_200px_110px_40px] items-center gap-4 border-b border-hairline bg-iron-900 px-6 py-3.5"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium text-txt">{repo.name}</span>
            <span className="mt-0.5 block truncate font-mono text-[11px] text-txt-faint">
              {repoLabel(localRef(repo))}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-txt-dim">
            <GitBranch className="size-3 shrink-0 text-txt-faint" />
            <span className="truncate">{repo.branch}</span>
          </span>
          <span className="font-mono text-[11px]">
            {repo.dirty ? <span className="text-slag">uncommitted</span> : <span className="text-txt-faint">clean</span>}
          </span>
          <button
            type="button"
            onClick={() => remove.mutate(repo.path)}
            title={`Remove ${repo.name}`}
            className="justify-self-end text-txt-faint opacity-0 transition-all hover:text-crack group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </>
  )
}

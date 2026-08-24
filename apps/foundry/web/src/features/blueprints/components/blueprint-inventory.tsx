import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { BlueprintEditorDialog } from './blueprint-editor-dialog'
import { Button } from '@/shared/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import { Skeleton } from '@/shared/ui/skeleton'
import { PageHeader } from '@/shared/components/page-header'
import { deleteBlueprint } from '../api'
import { blueprintQueries } from '../queries'
import type { Blueprint } from '../types'

function DeleteBlueprintDialog({ blueprint }: { blueprint: Blueprint }) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => deleteBlueprint({ data: blueprint.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blueprintQueries.all })
      toast.success(`Deleted "${blueprint.name}"`)
    },
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" title={`Delete ${blueprint.name}`} className="p-1 text-txt-faint transition-colors hover:text-crack">
          <Trash2 className="size-3.5" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-hairline bg-iron-850 sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{blueprint.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription className="text-txt-dim">
            Jobs that already ran it keep their own copy of the steps. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-iron-700 bg-transparent text-txt-dim hover:bg-iron-800 hover:text-txt">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-crack text-primary-foreground hover:bg-crack/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function BlueprintInventory() {
  const { data: blueprints, isLoading } = useQuery(blueprintQueries.list())

  return (
    <>
      <PageHeader title="Blueprints">
        <span className="font-mono text-[11px] text-txt-faint">{blueprints?.length ?? 0} defined</span>
        <BlueprintEditorDialog
          trigger={
            <Button className="h-9 gap-2 rounded-md bg-ember px-4 text-[13px] font-semibold text-primary-foreground shadow-[0_0_20px_-6px_var(--ember)] hover:bg-ember-soft">
              <Plus className="size-4" />
              New blueprint
            </Button>
          }
        />
      </PageHeader>

      {isLoading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-b border-hairline px-4 py-4 lg:px-6">
            <Skeleton className="h-9 w-full bg-iron-800" />
          </div>
        ))}

      {!isLoading && blueprints?.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-24">
          <p className="text-[14px] text-txt-dim">No blueprints yet.</p>
          <p className="font-mono text-[12px] text-txt-faint">A blueprint is a sequence of steps, each on its own model.</p>
        </div>
      )}

      {blueprints?.map((bp) => (
        <div
          key={bp.id}
          className="group flex flex-col gap-2 border-b border-hairline bg-iron-900 px-4 py-3.5 lg:flex-row lg:items-start lg:gap-6 lg:px-6"
        >
          <span className="min-w-0 lg:w-[260px] lg:shrink-0">
            <span className="flex items-center gap-2 text-[13.5px] font-medium text-txt">
              <Layers className="size-3.5 shrink-0 text-txt-faint" />
              <span className="truncate">{bp.name}</span>
            </span>
            {bp.description && <span className="mt-0.5 block text-[12px] text-txt-dim">{bp.description}</span>}
          </span>

          <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11.5px]">
            {bp.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-txt-faint">→</span>}
                <span className="rounded border border-hairline bg-iron-850 px-2 py-0.5">
                  <span className="text-txt">{s.name}</span>
                  <span className="text-txt-faint"> · </span>
                  <span className="text-ember-soft">{s.model}</span>
                  {s.effort && <span className="text-txt-faint"> · {s.effort}</span>}
                </span>
              </li>
            ))}
          </ol>

          <span className="flex shrink-0 items-center gap-1 self-end lg:self-start lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100">
            <BlueprintEditorDialog
              blueprint={bp}
              trigger={
                <button type="button" title={`Edit ${bp.name}`} className="p-1 text-txt-faint transition-colors hover:text-txt">
                  <Pencil className="size-3.5" />
                </button>
              }
            />
            <DeleteBlueprintDialog blueprint={bp} />
          </span>
        </div>
      ))}
    </>
  )
}

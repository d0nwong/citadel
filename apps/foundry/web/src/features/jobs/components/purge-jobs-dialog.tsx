import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { purgeJobs } from '../api'
import { jobQueries } from '../queries'

export function PurgeJobsDialog({ purgeable }: { purgeable: number }) {
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => purgeJobs(),
    onSuccess: ({ count }) => {
      qc.invalidateQueries({ queryKey: jobQueries.all })
      toast.success(`Purged ${count} job${count === 1 ? '' : 's'}`)
    },
  })

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          disabled={purgeable === 0}
          className="h-9 gap-2 rounded-md border-iron-700 bg-transparent px-3 text-[13px] text-txt-dim hover:border-crack/40 hover:bg-crack/10 hover:text-crack disabled:opacity-40"
        >
          <Trash2 className="size-4" />
          Purge jobs
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent className="border-hairline bg-iron-850 sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Purge {purgeable} completed job{purgeable === 1 ? '' : 's'}?</AlertDialogTitle>
          <AlertDialogDescription className="text-txt-dim">
            This permanently deletes their history and logs. Running and queued jobs are not
            affected. This can&apos;t be undone.
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
            Purge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

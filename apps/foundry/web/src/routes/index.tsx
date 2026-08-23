import { createFileRoute } from '@tanstack/react-router'
import { JobLedger } from '@/features/jobs/components/job-ledger'

export const Route = createFileRoute('/')({ component: JobsPage })

function JobsPage() {
  return <JobLedger />
}

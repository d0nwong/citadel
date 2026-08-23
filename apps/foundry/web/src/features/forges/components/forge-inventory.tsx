import { useQuery } from '@tanstack/react-query'
import { ForgeCard } from './forge-card'
import { forgeQueries } from '../queries'
import { jobQueries } from '@/features/jobs/queries'
import { PageHeader } from '@/shared/components/page-header'

export function ForgeInventory() {
  const { data: forges } = useQuery(forgeQueries.list())
  const { data: jobs } = useQuery(jobQueries.list())

  return (
    <>
      <PageHeader title="Forges" />
      <div className="grid grid-cols-1 gap-px bg-hairline p-px xl:grid-cols-2">
        {forges?.map((forge) => (
          <ForgeCard
            key={forge.name}
            forge={forge}
            currentTask={jobs?.find((j) => j.id === forge.currentJobId)?.task}
          />
        ))}
      </div>
    </>
  )
}

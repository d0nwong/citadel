import { useQuery } from '@tanstack/react-query'
import { ForgeCard } from './forge-card'
import { forgeQueries } from '../queries'
import { jobQueries } from '@/features/jobs/queries'
import { PageHeader } from '@/shared/components/page-header'
import type { AdapterInfo, Forge } from '../types'
import type { Job } from '@/features/jobs/types'

function AdapterSection({
  adapter,
  forges,
  jobs,
}: {
  adapter: AdapterInfo
  forges: Array<Forge>
  jobs: Array<Job>
}) {
  const running = forges.filter((f) => f.status === 'busy').length

  return (
    <section>
      <div className="flex items-center gap-3 border-b border-hairline bg-iron-900/60 px-6 py-2.5">
        <span className="kicker">{adapter.label}</span>
        <span className="font-mono text-[10px] text-txt-faint">{adapter.lifecycle}</span>
        <span className="ml-auto font-mono text-[10px] text-txt-faint">
          {adapter.lifecycle === 'pooled'
            ? `${running}/${forges.length} busy`
            : `${running} running · ${adapter.concurrency ?? '∞'} concurrent`}
        </span>
      </div>

      {/* An ephemeral adapter provisions per job, so between jobs there is
          genuinely nothing to list — show capacity instead of empty cards. */}
      {forges.length === 0 ? (
        <p className="px-6 py-5 font-mono text-[12px] text-txt-faint">
          {adapter.lifecycle === 'ephemeral'
            ? 'nothing running — forges are provisioned per job'
            : 'no forges created yet'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-px bg-hairline p-px xl:grid-cols-2">
          {forges.map((forge) => (
            <ForgeCard
              key={forge.name}
              forge={forge}
              currentTask={jobs.find((j) => j.id === forge.currentJobId)?.task}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function ForgeInventory() {
  const { data: adapters } = useQuery(forgeQueries.adapters())
  const { data: forges } = useQuery(forgeQueries.list())
  const { data: jobs } = useQuery(jobQueries.list())

  return (
    <>
      <PageHeader title="Forges" />
      {adapters?.map((adapter) => (
        <AdapterSection
          key={adapter.id}
          adapter={adapter}
          forges={(forges ?? []).filter((f) => f.adapter === adapter.id)}
          jobs={jobs ?? []}
        />
      ))}
    </>
  )
}

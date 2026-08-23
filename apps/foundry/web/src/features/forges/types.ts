export type ForgeStatus = 'idle' | 'busy' | 'stopped'

export interface Forge {
  name: string
  status: ForgeStatus
  image: string
  cpus: number
  memory: string
  createdAt: number
  currentJobId?: string
  jobsRun: number
}

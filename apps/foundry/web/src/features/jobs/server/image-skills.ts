/**
 * Node-only. Whether the forge image actually ships the skills a blueprint's
 * steps invoke (CTD-236). An image built before a skill's ticket landed
 * (CTD-214's `forge-merge`, say) answers a step's `/forge-merge` with "Unknown
 * command" instead of running it — forge-run.sh now catches that too, but
 * only once a container is already up and a job already spent. This preflight
 * catches it before a container starts at all, naming the missing skill.
 *
 * The list is read straight from the image, `/opt/foundry/skills`
 * (image/Dockerfile), and cached by image id — `foundry build` mints a new
 * id, so a rebuild is never served the previous build's answer.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BlueprintStep } from '@/features/blueprints/types'

const exec = promisify(execFile)

/**
 * Every docker call is pinned to the OrbStack context, the same as
 * job-runner.ts's own — forges are an OrbStack feature.
 */
const DOCKER_CONTEXT = process.env.FOUNDRY_DOCKER_CONTEXT ?? 'orbstack'

/** The `/<skill>` a step's prompt invokes — every seeded step's prompt starts with one. A prompt naming none has nothing to check. */
export function stepSkill(step: Pick<BlueprintStep, 'prompt'>): string | null {
  return /^\/([a-zA-Z0-9_-]+)/.exec(step.prompt.trim())?.[1] ?? null
}

/** Every skill a blueprint's steps invoke, deduped, in the order first named. */
export function namedSkills(steps: Array<Pick<BlueprintStep, 'prompt'>>): Array<string> {
  return [...new Set(steps.map(stepSkill).filter((s): s is string => s !== null))]
}

/** Which of the named skills the image does not have. Pure, for the tests. */
export function missingSkills(named: Array<string>, available: ReadonlySet<string>): Array<string> {
  return named.filter((s) => !available.has(s))
}

const cache = new Map<string, Set<string>>()

/** `docker image inspect <image>`'s id — a rebuild always mints a new one. */
async function imageId(image: string): Promise<string> {
  const { stdout } = await exec('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], {
    timeout: 30_000,
    env: { ...process.env, DOCKER_CONTEXT },
  })
  return stdout.trim()
}

/** `/opt/foundry/skills`'s entries in `image`, cached by the image's id. */
export async function imageSkills(image: string): Promise<Set<string>> {
  const id = await imageId(image)
  const cached = cache.get(id)
  if (cached) return cached
  const { stdout } = await exec('docker', ['run', '--rm', '--entrypoint', 'ls', image, '/opt/foundry/skills'], {
    timeout: 30_000,
    env: { ...process.env, DOCKER_CONTEXT },
  })
  const names = new Set(
    stdout
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  cache.set(id, names)
  return names
}

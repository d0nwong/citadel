import { createFileRoute } from '@tanstack/react-router'
import { RepoInventory } from '@/features/repos/components/repo-inventory'

export const Route = createFileRoute('/repos')({ component: RepoInventory })

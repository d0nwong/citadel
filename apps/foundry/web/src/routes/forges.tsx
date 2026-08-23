import { createFileRoute } from '@tanstack/react-router'
import { ForgeInventory } from '@/features/forges/components/forge-inventory'

export const Route = createFileRoute('/forges')({ component: ForgeInventory })

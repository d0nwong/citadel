import { createFileRoute } from '@tanstack/react-router'
import { BlueprintInventory } from '@/features/blueprints/components/blueprint-inventory'

export const Route = createFileRoute('/blueprints')({ component: BlueprintInventory })

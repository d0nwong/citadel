/**
 * This file is the historical import path only. The Linear client — and `splitKey`, its
 * router's parse — moved to `packages/tickets` (CTD-198), the shared package Pensieve and
 * Foundry are moving onto next; `ticketStates` here is the package's Linear adapter called
 * directly, not through the provider router, so this file and its test keep behaving exactly
 * as before. `blockers.ts` reads through the package's router now, for AC2's sake; this shim
 * exists only so nothing else that already imports "./linear.ts" has to change.
 */

export { LINEAR_API_URL, linearTicketStates as ticketStates, splitKey, stateOf } from "@citadel/tickets";
export type { TicketState, TicketStates } from "@citadel/tickets";

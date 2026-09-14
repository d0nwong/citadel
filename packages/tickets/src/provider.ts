/**
 * The shape every provider answers a ticket in, and the interface each one implements
 * (CTD-198, CTD-199, CTD-200, CTD-201). `CTD` and `ALD` route to Linear (`linear.ts`);
 * `AP` routes to Trello (`trello.ts`); `key.ts` holds the table. `get`, `states`,
 * `listOpen`, `create` and `update` are implemented for both; `claim` is Linear-only
 * today (CTD-204) and `link` still throws — the PR attachment on a card is ticket 8/14's.
 */

/** who a ticket is assigned to, when its provider knows */
export type Assignee = { id: string };

/** the list category a Trello `open` card's list maps to; unset for a Linear ticket today */
export type Stage = "triage" | "unstarted" | "started";

export type TicketState =
  | { state: "done"; at: string; name: string; url: string; provider: string; assignee?: Assignee }
  | { state: "canceled"; at: string; name: string; url: string; provider: string; assignee?: Assignee }
  | { state: "open"; name: string; url: string; provider: string; assignee?: Assignee; stage?: Stage }
  | { state: "unknown" };

/** looks up one key's last-read state; `unknown` for a key nobody answered */
export type TicketStates = (key: string) => TicketState;

/** a state's `provider`, spelled for a report line: `"linear"` → `"Linear"`, `"trello"` → `"Trello"` */
export const providerLabel = (name: string): string => (name ? name[0]!.toUpperCase() + name.slice(1) : name);

/** what `get` answers: the ticket itself, for a skill, a job brief or a card to read */
export type Ticket = {
  key: string;
  title: string;
  url: string;
  description: string;
  state: TicketState;
  /** the parent ticket's key, when it has one */
  parentKey?: string;
};

export type ListOpenOptions = { mine?: boolean; unassigned?: boolean; team?: string };

/**
 * `assigneeId` is `"me"` for the credential's own user, `null` for explicitly unassigned,
 * or the provider's own member/user id — the ids `get`/`listOpen` already print on a
 * ticket's `state.assignee`. `team` picks the provider on `create` (`providerNameForTeam`);
 * `project` is a Linear project name or a Trello label name, created on the team/board
 * when it is new.
 */
export type CreateTicketInput = {
  title: string;
  description: string;
  team: string;
  project?: string;
  assigneeId?: string | null;
  parent?: string;
  blockedBy?: string[];
};

/** `state` is a Linear workflow state's name, or an `AP` card's target list — CTD-201's list move / state change (spec S-18). */
export type UpdateTicketInput = Partial<Omit<CreateTicketInput, "team">> & { state?: string };

export type LinkInput = { kind: "pr"; url: string; title?: string };

/**
 * One tracker, reached by the key's prefix through `router.ts`. `get` and `states` are
 * reads; `listOpen` lists a provider's own open tickets; `create`, `update`, `claim` and
 * `link` write. `create`'s and `claim`'s `assigneeId` are optional — omitted (or `"me"`),
 * they assign the credential's own user, which is what Foundry's ticket claim means
 * (CTD-204).
 */
export interface TicketProvider {
  readonly name: string;
  get(key: string): Promise<Ticket | null>;
  states(keys: string[]): Promise<TicketStates>;
  listOpen(opts?: ListOpenOptions): Promise<Ticket[]>;
  create(input: CreateTicketInput): Promise<Ticket>;
  update(key: string, input: UpdateTicketInput): Promise<Ticket>;
  claim(key: string, assigneeId?: string): Promise<void>;
  link(key: string, input: LinkInput): Promise<void>;
}

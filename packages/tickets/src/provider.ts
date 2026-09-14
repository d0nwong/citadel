/**
 * The shape every provider answers a ticket in, and the interface each one implements
 * (CTD-198, CTD-199). `CTD` and `ALD` route to Linear (`linear.ts`); `AP` routes to Trello
 * (`trello.ts`); `key.ts` holds the table. `get` and `states` are implemented for both —
 * the other five verbs throw until the ticket that writes them (ticket 4) lands.
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

export type CreateTicketInput = {
  title: string;
  description: string;
  team: string;
  project?: string;
  assigneeId?: string;
  parent?: string;
  blockedBy?: string[];
};

export type UpdateTicketInput = Partial<Omit<CreateTicketInput, "team">>;

export type LinkInput = { kind: "pr"; url: string; title?: string };

/**
 * One tracker, reached by the key's prefix through `router.ts`. `get` and `states` are
 * reads; `listOpen` lists a provider's own open tickets; `create`, `update`, `claim` and
 * `link` write. `claim`'s `assigneeId` is optional — omitted, it assigns the credential's
 * own user, which is what Foundry's ticket claim means (CTD-204).
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

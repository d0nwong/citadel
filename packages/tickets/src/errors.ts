/**
 * Thrown by a provider's `get` or `claim` when the credential it needs is unset, so a
 * caller can answer a 503 naming the variable rather than guessing from a message
 * (CTD-204). `variable` is the environment/`.env` name the caller should point at —
 * `LINEAR_API_KEY` today, `TRELLO_API_KEY`/`TRELLO_TOKEN` once Trello lands.
 */
export class MissingCredentialError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} is not set`);
    this.name = "MissingCredentialError";
  }
}

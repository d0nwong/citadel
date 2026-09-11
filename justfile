# citadel's commands; `just` lists them. A recipe loads .env only where it needs to, so no
# recipe hands every key (the Slack token included) to the processes it starts. Arguments
# reach a recipe's shell as "$@", so a quoted one (a SQL string, a path) stays one argument.
set positional-arguments

# List the recipes.
default:
    @just --list

# Set up this machine: tools, the .env, dependencies, and a report of what is left.
bootstrap *phases:
    bun scripts/bootstrap.ts "$@"

# Report what bootstrap would do, changing nothing.
check:
    bun scripts/bootstrap.ts --check

# Store one credential in .env: linear, slack, claude, foundry-api or gateway.
auth what *flags:
    bun scripts/bootstrap.ts auth {{what}} {{flags}}

# Start the stack, or the services named (the sweep stays off until cutover).
up *services:
    bun scripts/stack.ts preflight
    docker compose --env-file .env up -d --wait --wait-timeout 120 {{services}}

# Stop the stack; the data volumes stay.
down:
    docker compose --env-file .env down

# What the stack is running.
ps:
    docker compose --env-file .env ps

# Follow the logs of the services named, or all of them.
logs *services:
    docker compose --env-file .env logs -f --tail 100 {{services}}

# Apply Foundry's database migrations (safe to rerun).
migrate:
    DATABASE_URL="$(bun scripts/stack.ts url)" bun run --filter foundry-web db:migrate

# Write a migration from Foundry's schema.ts; commit the file it creates.
db-generate:
    DATABASE_URL="$(bun scripts/stack.ts url)" bun run --filter foundry-web db:generate

# Drizzle studio over Foundry's database.
db-studio:
    DATABASE_URL="$(bun scripts/stack.ts url)" bun run --filter foundry-web db:studio

# Print the DATABASE_URL for the stack's postgres.
db-url:
    @bun scripts/stack.ts url

# A psql shell in the stack's postgres.
psql *args:
    bun scripts/stack.ts psql "$@"

# Share a dev server on your tailnet: `just serve foundry up`, `just serve pensieve dev`.
serve app *args:
    {{ if app == "foundry" { "apps/foundry/web/serve.sh" } else if app == "pensieve" { "apps/pensieve/scripts/serve.sh" } else { error("just serve foundry|pensieve ...") } }} {{args}}

# Install bb, the Bitbucket CLI Foundry opens PRs with.
setup-bb:
    apps/foundry/scripts/setup-bb.sh

# Foundry web on this Mac, which pushes and opens PRs with your own git, gh and bb credentials.
# Needs the stack's postgres (just up postgres mcp).
foundry *args:
    DATABASE_URL="$(bun scripts/stack.ts url)" bun run --filter foundry-web dev "$@"

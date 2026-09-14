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

# Store one credential in .env: linear, slack, trello, claude, foundry-api, gateway, gh or bitbucket.
auth what *flags:
    bun scripts/bootstrap.ts auth {{what}} {{flags}}

# Start everything: the stack, Foundry web on this Mac, local Pensieve, and the sweep loop.
start:
    just up
    just foundry-bg
    just pensieve-bg
    just tailscale-up

# Stop everything `just start` started; the data volumes stay.
stop:
    -just tailscale-down
    -pkill -f 'vite dev --port 3777'
    -kill $(lsof -tnP -iTCP:"${PENSIEVE_PORT:-3778}" -sTCP:LISTEN) 2>/dev/null
    just down

# Serve Pensieve (https :443) and Foundry (https :8443) on this machine's tailnet name.
# Skipped, not failed, when tailscale is missing or not logged in.
tailscale-up:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v tailscale >/dev/null || ! tailscale status >/dev/null 2>&1; then
      echo "tailscale is not running; skipping tailnet serve"
      exit 0
    fi
    tailscale serve --bg --https=443 "http://localhost:${PENSIEVE_PORT:-3778}"
    tailscale serve --bg --https=8443 http://localhost:3777
    host="$(tailscale status --json | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).Self.DNSName.replace(/\.$/, ""))')"
    echo "pensieve: https://$host"
    echo "foundry:  https://$host:8443"

# Take down the two tailnet serves `tailscale-up` added; other serves stay.
tailscale-down:
    -tailscale serve --https=443 off
    -tailscale serve --https=8443 off

# Start the stack, the sweep loop included, or only the services named.
up *services:
    bun scripts/stack.ts preflight
    bun scripts/stack.ts preflight-sweep
    docker compose --env-file .env --profile sweep up -d --wait --wait-timeout 120 {{services}}

# Rebuild the images the stack builds (Pensieve, the sweep) from scratch and restart on them;
# run after a merge. No build cache, so nothing from the old image survives; the images it
# replaces are pruned once the containers run on the new ones.
rebuild *services:
    bun scripts/stack.ts preflight
    bun scripts/stack.ts preflight-sweep
    docker compose --env-file .env --profile sweep build --pull --no-cache {{services}}
    docker compose --env-file .env --profile sweep up -d --force-recreate --wait --wait-timeout 120 {{services}}
    docker image prune -f

# Stop the stack, the sweep included; the data volumes stay. It names the sweep's profile so
# the sweep container goes down with the network it is attached to, rather than being left
# stopped on a network that no longer exists.
down:
    docker compose --env-file .env --profile sweep down

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

# It pushes and opens PRs with your own git, gh and bb credentials, so it stays on the host.

# Foundry web on this Mac (needs just up postgres mcp).
foundry *args:
    DATABASE_URL="$(bun scripts/stack.ts url)" bun run --filter foundry-web dev "$@"

# The same, detached, logging to .foundry-dev.log; this is what `just start` runs.
foundry-bg:
    #!/usr/bin/env bash
    set -euo pipefail
    if pgrep -f 'vite dev --port 3777' >/dev/null; then
      echo "foundry web is already on :3777"
      exit 0
    fi
    DATABASE_URL="$(bun scripts/stack.ts url)" nohup bun run --filter foundry-web dev \
      >.foundry-dev.log 2>&1 &
    echo "foundry web starting on :3777 (log: .foundry-dev.log)"

# Local Pensieve with bun in the background, logging to .pensieve.log; this is what
# `just start` runs. Skips when something is already listening on the Pensieve port
# (bun's own command line is too common to pgrep for, unlike foundry's vite one above).
pensieve-bg:
    #!/usr/bin/env bash
    set -euo pipefail
    port="${PENSIEVE_PORT:-3778}"
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "pensieve is already on :$port"
      exit 0
    fi
    root="$(pwd)"
    cd apps/pensieve
    if [[ ! -f dist/server/server.js ]]; then
      bun run build
    fi
    PORT="$port" nohup scripts/root-env.sh bun server.ts \
      >"$root/.pensieve.log" 2>&1 &
    echo "pensieve starting on :$port (log: .pensieve.log)"

# One sweep tick in the stack, the way the loop runs it; --dry-run only pulls and changes nothing.
sweep-once *args:
    bun scripts/stack.ts preflight-sweep "$@"
    docker compose --env-file .env --profile sweep run --rm sweep once "$@"

# Start only the sweep loop (`just up` already starts it with the stack).
sweep-on:
    bun scripts/stack.ts preflight-sweep
    docker compose --env-file .env --profile sweep up -d --wait sweep

# Stop the sweep loop in the stack.
sweep-off:
    docker compose --env-file .env --profile sweep stop sweep

# What release-please would propose. It reads this repo, so it uses gh's own token — .env's
# GH_TOKEN is scoped to the data repo alone, for the sweep's push.
release-dry:
    bunx release-please@17 release-pr --dry-run --repo-url https://github.com/d0nwong/citadel \
      --config-file release-please-config.json --manifest-file .release-please-manifest.json \
      --token "$(gh auth token 2>/dev/null || bun -e 'process.stdout.write(process.env.GH_TOKEN ?? "")')"

# Cutover only: point this machine's argus, accio, foundry and global skills at citadel.
link *args:
    bun scripts/link.ts "$@"

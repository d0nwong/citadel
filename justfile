# citadel's commands; `just` lists them. A recipe loads .env only where it needs to, so no
# recipe hands every key (the Slack token included) to the processes it starts.

# List the recipes.
default:
    @just --list

# Set up this machine: tools, the .env, dependencies, and a report of what is left.
bootstrap *phases:
    bun scripts/bootstrap.ts {{phases}}

# Report what bootstrap would do, changing nothing.
check:
    bun scripts/bootstrap.ts --check

# Store one credential in .env: linear, slack, claude, foundry-api or gateway.
auth what *flags:
    bun scripts/bootstrap.ts auth {{what}} {{flags}}

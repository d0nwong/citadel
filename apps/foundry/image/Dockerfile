# syntax=docker/dockerfile:1
FROM oven/bun:1-debian AS bun
FROM node:22-bookworm

ARG CLAUDE_VERSION=latest
ARG USER=dev
ARG UID=1000

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg git openssh-client \
      ripgrep jq less vim nano tmux zsh sudo procps unzip \
      build-essential python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# bun — the web/ package manager and script runner (bun run typecheck, …).
# Copied from the official image rather than curl|bash'd, so it is pinned and
# on PATH for every user.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# Claude Code
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_VERSION}" \
 && npm cache clean --force

# The node image already ships uid 1000 as "node"; rename it to $USER.
RUN usermod -l "$USER" -d "/home/$USER" -m node \
 && groupmod -n "$USER" node \
 && echo "$USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$USER \
 && chmod 0440 /etc/sudoers.d/$USER \
 && mkdir -p /work "/home/$USER/.claude" \
 && chown -R "$USER:$USER" /work "/home/$USER"

# pnpm (and yarn) via corepack. Enabled here, as root, because the shims land
# in root-owned /usr/local/bin — `corepack enable` from the unprivileged user
# dies with EACCES, which is what every agent working a pnpm repo tripped over
# before burning turns on `corepack pnpm …` / `npx pnpm@… …` workarounds.
# A repo's `packageManager` field still picks the exact version: corepack
# fetches it into COREPACK_HOME on first use, without the interactive download
# prompt (nobody is there to answer it). The pinned version is pre-fetched so
# the common case needs no network for pnpm itself.
ARG PNPM_VERSION=10.30.3
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
 && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && chown -R "$USER:$USER" /opt/corepack

COPY box-init.sh /usr/local/bin/box-init
RUN chmod +x /usr/local/bin/box-init

# Foundry-managed Claude Code skills; box-init syncs them into ~/.claude/skills
# on every start (the ~/.claude named volume shadows anything baked in there).
COPY --chown=$USER:$USER skills /opt/foundry/skills

USER $USER
WORKDIR /work
ENV SHELL=/bin/bash \
    EDITOR=vim \
    NPM_CONFIG_PREFIX=/home/dev/.npm-global \
    PATH=/home/dev/.npm-global/bin:/home/dev/.local/bin:$PATH \
    IS_SANDBOX=1

ENTRYPOINT ["/usr/local/bin/box-init"]
CMD ["sleep", "infinity"]

# syntax=docker/dockerfile:1
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

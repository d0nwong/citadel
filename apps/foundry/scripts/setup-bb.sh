#!/usr/bin/env bash
# Sets up bb-cli (https://github.com/bb-cli/bb-cli) — the Bitbucket CLI foundry
# shells out to when a job's origin is bitbucket.org, since `gh` does not speak
# Bitbucket. The host runs it with your credentials after a forge finishes; no
# container ever holds them.
#
# Adapted from scripts/setup-bb-cli.sh in alden-portal-fe. The difference is
# what it verifies against: that copy checks the token against its own checkout,
# and foundry's origin is GitHub. Here the target is a Bitbucket repo foundry
# could actually run a job on — the current checkout if it is one, else the
# first Bitbucket origin under ~/git, else Bitbucket's repository list.
#
# Run it any time; it is idempotent:
#
#   ./scripts/setup-bb.sh                 install/upgrade bb, then set up auth if needed
#   ./scripts/setup-bb.sh --verify        check the existing setup, change nothing
#   ./scripts/setup-bb.sh --reauth        replace the stored credentials
#   ./scripts/setup-bb.sh --repo own/rep  verify against a specific repository
#
# The auth step is the reason this wrapper exists. `bb auth` prompts for a
# username and an "app password" and stores whatever you type without checking
# it — including nothing at all, which is how an empty config gets written over
# a working one. This walks you to the right token page, takes the token
# without echoing it, and verifies it before writing anything.
set -euo pipefail

# Where bb keeps credentials. Hardcoded inside the phar as
# getenv('HOME').'/.bitbucket-rest-cli-config.json' — it honours no override.
CONFIG="$HOME/.bitbucket-rest-cli-config.json"
INSTALL_DIR="${BB_INSTALL_DIR:-$HOME/.local/bin}"
API="https://api.bitbucket.org/2.0"
TOKEN_PAGE="https://id.atlassian.com/manage-profile/security/api-tokens"
# Where foundry looks for job-target repos (web/.../repo-scan.ts SCAN_ROOTS).
SCAN_ROOT="$HOME/git"

mode=setup
repo_arg=""
while [ $# -gt 0 ]; do
  case "$1" in
    --verify|--verify-only) mode=verify; shift ;;
    --reauth) mode=reauth; shift ;;
    --repo) repo_arg="${2:?--repo needs owner/repo}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "curl is required (it verifies the token against Bitbucket)." >&2; exit 1; }
# bun is already a hard requirement of foundry, so it reads and writes bb's
# JSON config here rather than adding node to the list.
JSON=""
for candidate in bun node; do
  command -v "$candidate" >/dev/null 2>&1 && { JSON=$candidate; break; }
done
[ -n "$JSON" ] || { echo "bun (or node) is required — it reads and writes bb's JSON config." >&2; exit 1; }

# Colour lives in variables rather than in helper functions because most of the
# output below is a heredoc: `$(bold ...)` inside one runs in a subshell whose
# stdout is a pipe, so a tty check there would strip the colour it was meant to
# add. Decided once, here, against the script's real stdout.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; UL=$'\033[4m'; OFF=$'\033[0m'
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'
  BLUE=$'\033[0;34m'; CYAN=$'\033[0;36m'
else
  BOLD=""; DIM=""; UL=""; OFF=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; CYAN=""
fi

info() { printf '%s%s%s\n' "$DIM" "$*" "$OFF"; }
ok()   { printf '%s✓%s %s%s%s\n' "$GREEN" "$OFF" "$BOLD" "$*" "$OFF"; }
warn() { printf '%s!%s %s%s%s\n' "$YELLOW" "$OFF" "$YELLOW" "$*" "$OFF" >&2; }
die()  { printf '%s✗%s %s%s%s\n' "$RED" "$OFF" "$RED" "$*" "$OFF" >&2; exit 1; }

# A rule with a title on it, to break the run into visible phases.
rule() { printf '\n%s%s▸ %s%s\n' "$BOLD" "$BLUE" "$*" "$OFF"; }

# --- the repository bb will be talking to -----------------------------------
# Parses the same shape bb derives internally, so a remote this cannot read is
# one bb could not use either. Prints owner/repo, or nothing.
bb_path_of() {
  local url="${1:-}" p
  case "$url" in *bitbucket.org*) ;; *) return 1 ;; esac
  p=${url%.git}; p=${p%/}
  p=${p#*bitbucket.org}     # drops scheme, credentials and host
  p=${p#[:/]}               # ssh uses ':' here, https uses '/'
  [[ $p =~ ^[^/]+/[^/]+$ ]] || return 1
  printf '%s' "$p"
}

# foundry itself lives on GitHub, so unlike the alden copy there is usually no
# Bitbucket repo in cwd. Fall through: an explicit --repo, then this checkout,
# then the first Bitbucket origin among the repos foundry can target, then
# nothing — in which case the credential is checked against the account's
# repository list instead, which needs the same read scope.
resolve_repo() {
  local url path d
  if [ -n "$repo_arg" ]; then
    [[ $repo_arg =~ ^[^/]+/[^/]+$ ]] || die "--repo wants owner/repo, got: $repo_arg"
    repo_path="$repo_arg"; repo_src="--repo"; return
  fi
  url=$(git config --get remote.origin.url 2>/dev/null || true)
  if path=$(bb_path_of "$url"); then repo_path="$path"; repo_src="this checkout"; return; fi
  for d in "$SCAN_ROOT"/*/; do
    [ -d "$d/.git" ] || continue
    url=$(git -C "$d" config --get remote.origin.url 2>/dev/null || true)
    if path=$(bb_path_of "$url"); then
      repo_path="$path"; repo_src="${d%/}"; return
    fi
  done
  repo_path=""; repo_src=""
}

# --- 1. PHP ------------------------------------------------------------------
# bb ships as a PHP phar, not a static binary; it refuses to start below 7.0.
require_php() {
  command -v php >/dev/null 2>&1 || die \
"php is not installed — bb is a PHP phar and cannot run without it.
  macOS:  brew install php
  Debian: sudo apt install php-cli"
  local version
  version=$(php -r 'echo PHP_VERSION;')
  case "$(php -r 'echo version_compare(PHP_VERSION, "7.0.0", ">=") ? "ok" : "old";')" in
    ok) ok "php $version" ;;
    *)  die "php $version is too old — bb needs 7.0 or newer." ;;
  esac
}

# --- 2. bb itself ------------------------------------------------------------
bb_version() { "$@" --version 2>&1 | tr -d '\033' | sed 's/\[[0-9;]*m//g;s/^Version: //'; }

install_bb() {
  if command -v bb >/dev/null 2>&1; then
    ok "bb $(bb_version bb) at $(command -v bb)"
    # bb self-updates from its own GitHub releases; cheaper and more correct
    # than us second-guessing which asset belongs to which version.
    bb upgrade || warn "bb upgrade failed — continuing with the installed version."
    return
  fi

  info "Installing bb into $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR"
  local url
  url=$(curl -fsSL https://api.github.com/repos/bb-cli/bb-cli/releases/latest \
    | sed -nE 's/.*"browser_download_url": *"([^"]*\/bb)".*/\1/p' | head -1)
  [ -n "$url" ] || die "Could not find the bb asset on the latest bb-cli release.
Download it manually from https://github.com/bb-cli/bb-cli/releases and
move it to $INSTALL_DIR/bb."
  curl -fsSL "$url" -o "$INSTALL_DIR/bb"
  chmod +x "$INSTALL_DIR/bb"
  ok "Installed bb $(bb_version "$INSTALL_DIR/bb")"

  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *) warn "$INSTALL_DIR is not on your PATH. Add this to your shell profile:
    export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
}

# --- 3. verification ---------------------------------------------------------
# Checks a credential pair against a repository — or, with none to check
# against, the account's repository list. Everything bb does needs repository
# read at minimum, so a 200 here means the credential is at least usable; a
# 401/403 tells us which half is wrong while the user is still standing in
# front of the prompt.
#
# Sets $scopes from the X-OAuth-Scopes response header when Bitbucket sends one.
verify_credentials() {
  local user="$1" token="$2" headers status target
  if [ -n "$repo_path" ]; then target="$API/repositories/$repo_path"
  else target="$API/repositories?role=member&pagelen=1"; fi
  headers=$(mktemp)
  status=$(curl -s -o /dev/null -D "$headers" -w '%{http_code}' -u "$user:$token" "$target")
  scopes=$(sed -nE 's/^[Xx]-[Oo][Aa]uth-[Ss]copes: *(.*)$/\1/p' "$headers" | tr -d '\r')
  rm -f "$headers"

  case "$status" in
    200) return 0 ;;
    401) warn "Bitbucket rejected the credentials (401).
The username must be the *email address* of the Atlassian account that owns
the token — not your Bitbucket display name or workspace slug." ;;
    403) warn "Authenticated, but no access to ${repo_path:-your repositories} (403).
Either the token is missing the repository read scope, or that Atlassian
account has not been granted access to the repository." ;;
    404) warn "Bitbucket returned 404 for ${repo_path:-the repository list}.
Tokens without repository read see 404 rather than 403, so this most likely
means the scope is missing." ;;
    *)   warn "Bitbucket returned $status while checking ${repo_path:-the repository list}." ;;
  esac
  return 1
}

# Warn about scopes bb needs that the token does not carry. Bitbucket only
# sends this header for scoped credentials, so silence here is not a failure —
# it just means we cannot check, and the 200 above already proved read access.
report_scopes() {
  [ -n "${scopes:-}" ] || return 0
  # Bitbucket returns the token's entire scope list — forty-odd entries on a
  # broadly-granted token. Reporting only the four bb needs keeps the useful
  # signal (what is *missing*) from being buried in a wall of green.
  local missing="" scope
  for scope in read:repository read:pullrequest write:pullrequest read:pipeline; do
    case ",${scopes// /}," in
      *",$scope:bitbucket,"*) ;;
      *) missing="$missing $scope" ;;
    esac
  done
  if [ -z "$missing" ]; then
    info "Token carries every scope bb needs."
  else
    warn "Token is missing:$missing
Scopes are fixed at creation — create a replacement token and re-run with --reauth."
  fi
}

# --- 4. the guided auth walkthrough -----------------------------------------
prompt_for_token() {
  if [ "$mode" = verify ]; then
    die "No usable credentials in $CONFIG. Re-run without --verify to set them up."
  fi

  local n="${CYAN}${BOLD}"   # step numbers
  cat <<EOF

${BOLD}${BLUE}▸ Create an Atlassian API token for Bitbucket${OFF}

${DIM}App passwords are on their way out; scoped API tokens are the replacement,
and they authenticate the same way — Basic auth, token in place of the
password.${OFF}

  ${n}1.${OFF} Open ${UL}${BLUE}$TOKEN_PAGE${OFF}
     ${DIM}Atlassian profile -> Account settings -> Security -> Create and
     manage API tokens — the same page whichever route you take.${OFF}

  ${n}2.${OFF} Choose ${BOLD}"Create API token with scopes"${OFF}
     ${YELLOW}An unscoped token authenticates but is refused by every Bitbucket
     endpoint — that is the confusing failure this step exists to avoid.${OFF}

  ${n}3.${OFF} Name it something you will recognise later ${DIM}("foundry bb-cli, <your machine>")${OFF}
     and give it an expiry.

  ${n}4.${OFF} Select ${BOLD}Bitbucket${OFF} as the app.

  ${n}5.${OFF} Grant at least:
       ${GREEN}read:repository:bitbucket${OFF}     ${DIM}every bb command${OFF}
       ${GREEN}read:pullrequest:bitbucket${OFF}    ${DIM}reading review comments for a follow-up job${OFF}
       ${GREEN}write:pullrequest:bitbucket${OFF}   ${DIM}bb pr create — how a job's work comes back${OFF}
       ${GREEN}read:pipeline:bitbucket${OFF}       ${DIM}bb pipeline${OFF}
     ${YELLOW}Scopes are fixed at creation — widening them later means a new token.${OFF}

  ${n}6.${OFF} ${BOLD}Copy the token now${OFF} — Atlassian shows it exactly once.

EOF

  local opener="" reply
  for candidate in open xdg-open; do
    if command -v "$candidate" >/dev/null 2>&1; then opener=$candidate; break; fi
  done
  if [ -n "$opener" ]; then
    read -r -p "Open the token page in your browser? [Y/n] " reply
    case "${reply:-y}" in [Nn]*) ;; *) "$opener" "$TOKEN_PAGE" >/dev/null 2>&1 || true ;; esac
  fi

  local email token
  read -r -p "Atlassian account email: " email
  [ -n "$email" ] || die "No email entered."
  # -s so the token never lands in the terminal scrollback, and never in
  # shell history the way an inline `bb auth` argument would.
  read -r -s -p "API token (input hidden): " token; echo
  [ -n "$token" ] || die "No token entered."

  printf '\n%sChecking the token against %s%s%s...%s\n' \
    "$DIM" "$OFF$BOLD" "${repo_path:-your Bitbucket repositories}" "$OFF$DIM" "$OFF"
  verify_credentials "$email" "$token" || die "Not saving — nothing was written to $CONFIG."

  write_config "$email" "$token"
  report_scopes
  ok "Authenticated as $email${repo_path:+ for $repo_path}."
}

# bb reads auth.username / auth.appPassword and sends them as HTTP Basic. It
# writes this file itself with default permissions; we tighten to 0600 because
# the token sits here in plaintext (`bb auth show` prints it in full).
write_config() {
  local user="$1" token="$2" tmp
  tmp=$(mktemp)
  chmod 600 "$tmp"
  # Merged rather than overwritten: the same file holds any other bb settings,
  # and replacing it wholesale would silently drop them.
  BB_USER="$user" BB_TOKEN="$token" "$JSON" -e '
    const fs = require("fs");
    const path = process.argv[1];
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path, "utf8")) || {}; } catch {}
    config.auth = { ...config.auth, username: process.env.BB_USER, appPassword: process.env.BB_TOKEN };
    fs.writeFileSync(process.argv[2], JSON.stringify(config, null, 4) + "\n");
  ' "$CONFIG" "$tmp"
  mv "$tmp" "$CONFIG"
  chmod 600 "$CONFIG"
  info "Saved to $CONFIG (mode 600)."
}

setup_auth() {
  if [ "$mode" = reauth ] || [ ! -f "$CONFIG" ]; then
    prompt_for_token
    return
  fi

  local user token
  # One read, tab-separated: a malformed or partial config comes back as two
  # empty fields rather than a parse error mid-script.
  IFS=$'\t' read -r user token < <("$JSON" -e '
    const fs = require("fs");
    let config = {};
    try { config = JSON.parse(fs.readFileSync(process.argv[1], "utf8")) || {}; } catch {}
    const auth = config.auth || {};
    process.stdout.write((auth.username || "") + "\t" + (auth.appPassword || ""));
  ' "$CONFIG") || true   # no trailing newline, so `read` reports EOF even on success

  if [ -z "$user" ] || [ -z "$token" ]; then
    warn "$CONFIG exists but has no credentials in it."
    prompt_for_token
    return
  fi

  info "Found credentials for $user in $CONFIG"
  if verify_credentials "$user" "$token"; then
    report_scopes
    ok "bb is authenticated as $user${repo_path:+ for $repo_path}."
    return
  fi

  if [ "$mode" = verify ]; then
    die "Existing credentials do not work. Re-run with --reauth to replace them."
  fi
  local reply
  read -r -p "Replace them now? [Y/n] " reply
  case "${reply:-y}" in [Nn]*) die "Left the existing credentials in place." ;; esac
  prompt_for_token
}

# --- run ---------------------------------------------------------------------
rule "Environment"
require_php
if [ "$mode" = verify ]; then
  command -v bb >/dev/null 2>&1 || die "bb is not installed — run this script with no arguments."
  ok "bb at $(command -v bb)"
else
  install_bb
fi

resolve_repo
if [ -n "$repo_path" ]; then
  info "Verifying against $repo_path (from $repo_src)"
else
  info "No Bitbucket repository found under $SCAN_ROOT — verifying against your repository list instead."
fi

rule "Authentication"
setup_auth

if [ "$mode" != verify ]; then
  cat <<EOF

${BOLD}${GREEN}▸ Ready.${OFF} What foundry does with it:

  ${DIM}A job whose origin is bitbucket.org finishes on the host — ${OFF}${GREEN}bb pr create${OFF}${DIM},
  then a Linear attachment for any ticket id in the PR body or the task text.
  The forge container never sees this token.${OFF}

  ${GREEN}./scripts/setup-bb.sh --verify${OFF}   ${DIM}check it still works${OFF}
  ${GREEN}foundry doctor${OFF}                   ${DIM}the rest of the host's credentials${OFF}
EOF
fi

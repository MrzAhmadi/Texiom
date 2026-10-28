#!/usr/bin/env bash
# Runs every test; this is what CI runs. Needs only bash (shellcheck is used if present).
set -u
export PYTHONDONTWRITEBYTECODE=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
status=0
step() { echo; echo "== $1"; shift; "$@" || status=1; }

SCRIPTS=(texiom lib/*.sh docker/config.sh docker/action-entrypoint.sh packaging/install.sh tests/*.sh tests/fakebin/* tests/fakelatexmk/*)
step "bash syntax" bash -c 'for f in "$@"; do bash -n "$f" || exit 1; done' _ "${SCRIPTS[@]}"
if command -v shellcheck >/dev/null 2>&1; then
    step "shellcheck" shellcheck -S warning -x "${SCRIPTS[@]}"
fi
step "pack catalogue" bash tests/catalogue.sh
step "texiom.toml parser" bash tests/config.sh
step "GitHub Action entrypoint" bash tests/action.sh
step "CLI (fake docker)" bash tests/cli.sh

echo
[[ "$status" -eq 0 ]] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit "$status"

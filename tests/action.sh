#!/usr/bin/env bash
# docker/action-entrypoint.sh, the script the GitHub Action runs inside the image, with a fake latexmk.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/tests/fakelatexmk:$PATH" TEXIOM_CONFIG_LIB="$ROOT/docker/config.sh"
unset GITHUB_OUTPUT
PASS=0; FAIL=0
expect() { local desc="$1"; shift; if "$@" >/dev/null 2>&1; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: $desc"; echo "$OUT" | tail -5; fi; }
run() { OUT="$(cd "$T" && env "$@" bash "$ROOT/docker/action-entrypoint.sh" 2>&1)"; RC=$?; }
has() { grep -qF -- "$1" <<<"$OUT"; }

T="$(mktemp -d)"; mkdir -p "$T/sub"; : > "$T/sub/main.tex"

run INPUT_ROOT_FILE=main.tex INPUT_WORKING_DIRECTORY=sub
expect "build succeeds without any runner output file" test "$RC" -eq 0
expect "reports the PDF path on stdout for action.yml" has "TEXIOM_PDF_PATH=sub/main.pdf"
expect "default engine and flags" has "latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex"

run INPUT_ROOT_FILE=main INPUT_WORKING_DIRECTORY=sub INPUT_ENGINE=xelatex INPUT_SHELL_ESCAPE=true INPUT_ARGS=-bibtex
expect "root_file without .tex is accepted" has "TEXIOM_PDF_PATH=sub/main.pdf"
expect "engine, shell_escape and extra args are applied" has "latexmk -xelatex -shell-escape -interaction=nonstopmode -halt-on-error -bibtex main.tex"

printf 'file = "main.tex"\nengine = "lualatex"\n' > "$T/sub/texiom.toml"
run INPUT_WORKING_DIRECTORY=sub
expect "texiom.toml supplies the root file and engine" has "latexmk -lualatex"
expect "and the PDF path" has "TEXIOM_PDF_PATH=sub/main.pdf"
rm "$T/sub/texiom.toml"

run INPUT_WORKING_DIRECTORY=sub
expect "no root file anywhere is an error" test "$RC" -ne 0

run INPUT_ROOT_FILE=main.tex INPUT_WORKING_DIRECTORY=sub INPUT_APT='a;b'
expect "an unsafe package name is rejected" has "invalid package name"

echo "action tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]

#!/usr/bin/env bash
# texiom.toml parsing (docker/config.sh), shared by the CLI and the Action entrypoint.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/docker/config.sh"
PASS=0; FAIL=0
expect() { local desc="$1"; shift; if "$@" >/dev/null 2>&1; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: $desc"; fi; }

reset() { TEX_FILE=""; ENGINE=""; PDF_ONLY=0; WATCH=0; SHELL_ESCAPE=0; APT_PKGS=""; PIP_PKGS=""; }
D="$(mktemp -d)"

reset
cat > "$D/texiom.toml" <<'TOML'
# comment
file = "main.tex"      # trailing comment
engine = "xelatex"
pdf_only = true
shell_escape = true
apt = ["inkscape", "poppler-utils"]
pip = [
  "pygments",   # minted
  "pandas==2.2.0",
]
TOML
load_config "$D" 2>/dev/null
expect "string keys are read" test "$TEX_FILE|$ENGINE" = "main.tex|xelatex"
expect "booleans are read" test "$PDF_ONLY|$SHELL_ESCAPE|$WATCH" = "1|1|0"
expect "single-line arrays are read" test "$(echo $APT_PKGS)" = "inkscape poppler-utils"
expect "multi-line arrays with comments are read" test "$(echo $PIP_PKGS)" = "pygments pandas==2.2.0"

reset; TEX_FILE="cli.tex"; ENGINE="lualatex"
load_config "$D" 2>/dev/null
expect "command-line values win over the file" test "$TEX_FILE|$ENGINE" = "cli.tex|lualatex"

reset; printf 'bogus = 1\n' > "$D/texiom.toml"
expect "unknown keys only warn" bash -c "source '$ROOT/docker/config.sh'; TEX_FILE=''; ENGINE=''; PDF_ONLY=0; WATCH=0; SHELL_ESCAPE=0; APT_PKGS=''; PIP_PKGS=''; load_config '$D' 2>&1 | grep -q 'unknown key'"

reset
expect "no texiom.toml is fine" load_config "$(mktemp -d)"
expect "bad package names are rejected" bash -c "source '$ROOT/docker/config.sh'; ! (validate_packages 'a;b') 2>/dev/null"
expect "good package names pass" bash -c "source '$ROOT/docker/config.sh'; validate_packages inkscape pandas==2.2.0 libfoo+bar"

echo "config tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]

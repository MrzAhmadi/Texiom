#!/usr/bin/env bash
# CLI behaviour tests against a fake docker (tests/fakebin): images, packs, layering, diagnosis.
# Nothing here touches the real Docker, your ~/.config or your images.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/tests/fakebin:$PATH"
PASS=0; FAIL=0

new_env() {
    T="$(mktemp -d)"
    export FAKE_STATE="$T/state" HOME="$T/home" TEXIOM_CACHE_DIR="$T/cache"
    unset XDG_CONFIG_HOME XDG_CACHE_HOME FAKE_PULL_HASH FAKE_REMOTE_HASH FAKE_BUILD_OUTPUT FAKE_BUILD_STATUS TEXIOM_NO_RETRY
    mkdir -p "$HOME" "$FAKE_STATE"
    PROJECT="$T/project"; mkdir -p "$PROJECT"; : > "$PROJECT/a.tex"
    HASH="$(source "$ROOT/lib/image.sh"; docker_context_hash "$ROOT")"
}

tex() { OUT="$(bash "$ROOT/texiom" "$@" 2>&1)"; RC=$?; }
calls() { cat "$FAKE_STATE/calls.log" 2>/dev/null; }
check() {  # check "description" condition-command...
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: $desc"; echo "--- output:"; echo "$OUT" | tail -15; echo "--- calls:"; calls | tail -8; fi
}
out_has() { grep -qF -- "$1" <<<"$OUT"; }
out_lacks() { ! grep -qF -- "$1" <<<"$OUT"; }
out_count_is() { [[ "$(grep -cF -- "$1" <<<"$OUT")" -eq "$2" ]]; }
calls_have() { calls | grep -qF -- "$1"; }
calls_lack() { ! calls | grep -qF -- "$1"; }

# --- base image (fetched when a command needs it) --------------------------------------------
new_env; export FAKE_PULL_HASH="$HASH" FAKE_REMOTE_HASH="$HASH"
tex -d "$PROJECT" -f a.tex
check "matching published image is downloaded, not built" calls_have "docker pull ghcr.io/mrzahmadi/texiom:slim"
check "no local build when the published image matches" calls_lack "docker build"
: > "$FAKE_STATE/calls.log"
tex -d "$PROJECT" -f a.tex
check "second run reuses the base image" calls_lack "docker pull"

new_env; export FAKE_PULL_HASH="$HASH" FAKE_REMOTE_HASH="deadbeef"
tex -d "$PROJECT" -f a.tex
check "a different published version triggers a local slim build" calls_have "docker build --target slim"
check "and the pull is skipped" calls_lack "docker pull"

new_env; export FAKE_PULL_HASH="$HASH" FAKE_REMOTE_HASH="$HASH"
tex --no-pull -d "$PROJECT" -f a.tex
check "--no-pull builds locally" calls_have "docker build --target slim"
check "--no-pull never pulls" calls_lack "docker pull"

new_env
tex -d "$PROJECT" -f a.tex
check "an unreachable registry falls back to a local build" calls_have "docker build --target slim"

# --- packs: catalogue listing (reads files only, no Docker) -----------------------------------
new_env
tex packs
check "listing works without any image" test "$RC" -eq 0
check "listing never calls docker" test ! -e "$FAKE_STATE/calls.log"
check "listing shows groups" out_has "Languages"
check "listing shows descriptions" out_has "Arabic and Persian"
check "nothing is marked installed at first" out_lacks "[x] science"
check "listing shows no sizes" out_lacks " MB"
mkdir -p "$HOME/.config/texiom"; printf 'science\nlang-arabic\n' > "$HOME/.config/texiom/packs"
tex packs
check "installed packs are marked" out_has "[x] science"
check "other packs are not" out_has "[ ] publishers"

# --- packs: add / remove / layering -----------------------------------------------------------
new_env; export FAKE_PULL_HASH="$HASH" FAKE_REMOTE_HASH="$HASH"
tex add science minted
check "add succeeds" test "$RC" -eq 0
check "add builds the packs layer on the base" calls_have "FROM texiom"
check "add installs the packs' apt packages" calls_have "texlive-science"
check "add installs pygments for minted" calls_have "python3-pygments"
check "the selection is stored globally" test "$(cat "$HOME/.config/texiom/packs")" = "$(printf 'minted\nscience')"

: > "$FAKE_STATE/calls.log"
tex add gnuplot
check "adding another pack builds on the existing packs layer" calls_have "FROM texiom-packs:installed"
check "and installs only the new pack" bash -c "calls=\$(cat '$FAKE_STATE/calls.log'); grep -q gnuplot-nox <<<\"\$calls\" && ! grep -q 'install -y --no-install-recommends.*texlive-science' <<<\"\$calls\""
check "selection now has three packs" test "$(wc -l < "$HOME/.config/texiom/packs")" -eq 3

tex add science
check "adding an installed pack is reported" out_has "Already installed: science"

tex add nosuchpack
check "unknown pack is rejected" test "$RC" -ne 0

: > "$FAKE_STATE/calls.log"
tex remove science
check "remove rebuilds from the base with the remaining packs" calls_have "FROM texiom"$'\n'"RUN"
check "remaining packs are reinstalled" calls_have "python3-pygments"
check "removed pack is gone from the selection" bash -c "! grep -qx science '$HOME/.config/texiom/packs'"

tex packs
check "installed packs are marked in the listing" out_has "[x] minted"

# --- compile uses the packs layer; base change reinstalls packs -------------------------------
: > "$FAKE_STATE/calls.log"
tex -d "$PROJECT" -f a.tex
check "compile succeeds" test "$RC" -eq 0
check "compile runs in the packs image" calls_have "run-image texiom-packs:installed"
check "latexmk gets SyncTeX and file:line errors (for editors such as LaTeX Workshop)" calls_have "-synctex=1 -file-line-error -interaction=nonstopmode"
check "the project is mounted at its real path, so SyncTeX paths match the host" calls_have "-v $PROJECT:$PROJECT -w $PROJECT"

: > "$FAKE_STATE/calls.log"
tex --rebuild -d "$PROJECT" -f a.tex
check "a rebuilt base reinstalls the packs" out_has "The base image changed; reinstalling your packs"

# --- per-project extras sit on top ------------------------------------------------------------
: > "$FAKE_STATE/calls.log"
tex -d "$PROJECT" -f a.tex --apt inkscape
check "project extras are layered on the packs image" calls_have "FROM texiom-packs:installed"
check "and the build runs in the extras image" calls_have "run-image texiom-extras:"

# --pip pulls python3-pip into the extras layer on demand (it is not in the base image)
new_env; export FAKE_PULL_HASH="$HASH" FAKE_REMOTE_HASH="$HASH"
tex -d "$PROJECT" -f a.tex --pip pygments
check "--pip installs python3-pip in the extras layer" calls_have "python3-pip"
check "--pip installs the requested package" calls_have "pip3 install --break-system-packages --no-cache-dir pygments"

# the removed browser editor flags say so instead of failing obscurely
tex --edit
check "--edit explains the editor was removed" out_has "browser editor was removed"
check "and fails" test "$RC" -ne 0

# --- failure diagnosis ------------------------------------------------------------------------
new_env; export FAKE_PULL_HASH="$HASH" FAKE_REMOTE_HASH="$HASH" FAKE_BUILD_STATUS=1
printf "! LaTeX Error: File \`algorithm2e.sty' not found.\n" > "$T/out.log"; export FAKE_BUILD_OUTPUT="$T/out.log"
tex -d "$PROJECT" -f a.tex
check "failed build keeps its exit status" test "$RC" -eq 1
check "a missing package names its pack" out_has "provided by the pack 'science'"
check "and the command to install it" out_has "texiom add science"

# a repeated save of a failing document: latexmk only says "previous invocation", the real error is in the .log
printf "Latexmk: Nothing to do for 'a.tex'.\n  pdflatex: gave an error in previous invocation of latexmk.\n" > "$T/out.log"
printf "! LaTeX Error: File \`algorithm2e.sty' not found.\n" > "$PROJECT/a.log"
tex -d "$PROJECT" -f a.tex
check "a repeated failing build still names the missing pack (from the previous log)" out_has "provided by the pack 'science'"
rm -f "$PROJECT/a.log"

printf "! LaTeX Error: File \`mystyle.sty' not found.\n" > "$T/out.log"
tex -d "$PROJECT" -f a.tex
check "an unknown package file points to the full pack" out_has "texiom add full"

printf "! LaTeX Error: File \`figure.png' not found.\n" > "$T/out.log"
tex -d "$PROJECT" -f a.tex
check "a missing non-package file is not blamed on packs" out_lacks "texiom add"

printf "Package minted Error: You must have \`pygmentize' installed to use this package.\n" > "$T/out.log"
tex -d "$PROJECT" -f a.tex
check "minted without pygments names the minted pack" out_has "texiom add minted"

printf "Undefined control sequence.\n" > "$T/out.log"
tex -d "$PROJECT" -f a.tex
check "an ordinary LaTeX error gets no package hint" out_lacks "not installed"

# --- interactive retry (needs a pseudo-terminal) ------------------------------------------------
if command -v script >/dev/null 2>&1; then
    new_env; export FAKE_PULL_HASH="$HASH" FAKE_REMOTE_HASH="$HASH" FAKE_BUILD_STATUS=1
    printf "! LaTeX Error: File \`algorithm2e.sty' not found.\n" > "$T/out.log"; export FAKE_BUILD_OUTPUT="$T/out.log"
    OUT="$(cd "$T" && printf 'y\ny\n' | timeout 60 script -qec "bash $ROOT/texiom -d project -f a.tex" /dev/null 2>&1 | tr -d '\r')"
    check "answering yes installs the missing pack" out_has "Installed: science"
    check "and runs the build again from the original directory" bash -c "test \$(grep -c 'run-image' '$FAKE_STATE/calls.log') -ge 2"
    check "the retry does not fail on relative paths" out_lacks "No such file"
    check "a second failure does not prompt again" out_count_is "and build again?" 1
fi

echo "cli tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]

#!/usr/bin/env bash
# Smoke test of a freshly built image (needs Docker): usage: tests/smoke.sh IMAGE slim|full HASH
set -euo pipefail
IMAGE="$1"; VARIANT="$2"; HASH="$3"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

label() { docker image inspect --format "{{ index .Config.Labels \"$1\" }}" "$IMAGE"; }
fail() { echo "SMOKE TEST FAILED: $*" >&2; exit 1; }

[[ "$(label texiom.dockerhash)" == "$HASH" ]] || fail "image carries the wrong build hash"
[[ "$(label texiom.variant)" == "$VARIANT" ]] || fail "image is not the $VARIANT variant"
docker run --rm "$IMAGE" python3 -c "import fastapi, uvicorn" || fail "editor dependencies are missing"
docker run --rm "$IMAGE" test -x /usr/local/bin/texiom-action-entrypoint || fail "Action entrypoint is missing"

WORK="$(mktemp -d)"
# The container runs as root, so it also removes what it created.
trap 'docker run --rm -v "$WORK":/w "$IMAGE" sh -c "rm -rf /w/* /w/.[!.]*" >/dev/null 2>&1; rm -rf "$WORK" 2>/dev/null || true' EXIT
cp "$ROOT"/tests/smoke/* "$WORK/"

compile() {  # compile ENGINE-FLAG FILE
    docker run --rm -v "$WORK":/workspace -w /workspace "$IMAGE" \
        latexmk "$1" -interaction=nonstopmode -halt-on-error "$2" > "$WORK/build.out" 2>&1 \
        || { tail -20 "$WORK/build.out" >&2; fail "latexmk $1 $2 failed"; }
    [[ -f "$WORK/${2%.tex}.pdf" ]] || fail "$2 produced no PDF"
}

compile -pdf hello.tex          # pdfLaTeX + biber/biblatex + tikz
# T1 fonts without cm-super make TeX render bitmap (PK) fonts on the fly: slow and ugly PDFs.
! grep -q mktexpk "$WORK/build.out" || fail "bitmap fonts were generated for a T1 document - is cm-super installed?"
compile -xelatex fonts.tex
compile -lualatex fonts.tex

# The Action entrypoint, the way action.yml runs it.
rm -f "$WORK/hello.pdf"
docker run --rm -v "$WORK":/github/workspace -w /github/workspace \
    -e INPUT_ROOT_FILE=hello.tex -e INPUT_ENGINE=xelatex \
    --entrypoint /usr/local/bin/texiom-action-entrypoint "$IMAGE" >/dev/null || fail "Action entrypoint failed"
[[ -f "$WORK/hello.pdf" ]] || fail "Action entrypoint produced no PDF"

if [[ "$VARIANT" == slim ]]; then
    # The pack index tells users siunitx lives in 'science'; the slim image must really lack it.
    if docker run --rm -v "$WORK":/workspace -w /workspace "$IMAGE" \
            latexmk -pdf -interaction=nonstopmode -halt-on-error science.tex >/dev/null 2>&1; then
        fail "slim unexpectedly contains siunitx - regenerate lib/pack-index.tsv"
    fi
else
    compile -pdf science.tex
fi
echo "smoke test passed: $IMAGE ($VARIANT)"

#!/usr/bin/env bash
# Entry point of the GitHub Action. Inputs arrive as INPUT_* environment
# variables; texiom.toml in the working directory fills in whatever is unset.
set -euo pipefail

# shellcheck source=config.sh
source "${TEXIOM_CONFIG_LIB:-/usr/local/lib/texiom-config.sh}"

WORKING_DIRECTORY="${INPUT_WORKING_DIRECTORY:-.}"
TEX_FILE="${INPUT_ROOT_FILE:-}"
ENGINE="${INPUT_ENGINE:-}"
SHELL_ESCAPE=0; [[ "${INPUT_SHELL_ESCAPE:-}" != true ]] || SHELL_ESCAPE=1
INPUT_APT="${INPUT_APT:-}"; APT_PKGS="${INPUT_APT//,/ }"
INPUT_PIP="${INPUT_PIP:-}"; PIP_PKGS="${INPUT_PIP//,/ }"
# shellcheck disable=SC2034  # only read by load_config
PDF_ONLY=0
# shellcheck disable=SC2034
WATCH=0

cd "$WORKING_DIRECTORY"
load_config .

case "${ENGINE:=pdflatex}" in
    pdflatex) ENGINE_FLAG="-pdf" ;;
    xelatex)  ENGINE_FLAG="-xelatex" ;;
    lualatex) ENGINE_FLAG="-lualatex" ;;
    *) echo "Error: unknown engine '$ENGINE' (use pdflatex, xelatex or lualatex)." >&2; exit 1 ;;
esac

if [[ -z "$TEX_FILE" ]]; then
    echo "Error: no root file - set the root_file input or 'file' in texiom.toml." >&2
    exit 1
fi
[[ "$TEX_FILE" == *.tex ]] || TEX_FILE="${TEX_FILE}.tex"

# shellcheck disable=SC2086
validate_packages $APT_PKGS $PIP_PKGS
if [[ -n "$(echo $APT_PKGS)" ]]; then
    apt-get update -q && apt-get install -y -q $APT_PKGS
fi
if [[ -n "$(echo $PIP_PKGS)" ]]; then
    apt-get update -q && apt-get install -y -q --no-install-recommends python3-pip
    pip3 install --break-system-packages --no-cache-dir $PIP_PKGS
fi

SE_FLAG=""; [[ "$SHELL_ESCAPE" -eq 0 ]] || SE_FLAG="-shell-escape"
echo "Compiling '$TEX_FILE' in '$WORKING_DIRECTORY' with $ENGINE ..."
# shellcheck disable=SC2086
latexmk $ENGINE_FLAG $SE_FLAG -interaction=nonstopmode -halt-on-error ${INPUT_ARGS:-} "$TEX_FILE"

PDF_FILE="${TEX_FILE%.tex}.pdf"
if [[ ! -f "$PDF_FILE" ]]; then
    echo "Build finished but '$PDF_FILE' was not found." >&2
    exit 1
fi

PDF_PATH="${WORKING_DIRECTORY%/}/$PDF_FILE"
PDF_PATH="${PDF_PATH#./}"
echo "Done: $PDF_PATH"
# action.yml reads this line and sets the pdf_path output (a container cannot write to the
# runner's output file reliably).
echo "TEXIOM_PDF_PATH=$PDF_PATH"

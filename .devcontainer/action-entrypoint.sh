#!/usr/bin/env bash
set -euo pipefail

ROOT_FILE="$1"
WORKING_DIRECTORY="${2:-.}"
LATEXMK_ARGS="${3:--pdf -interaction=nonstopmode -halt-on-error}"

cd "$WORKING_DIRECTORY"
latexmk $LATEXMK_ARGS "$ROOT_FILE"

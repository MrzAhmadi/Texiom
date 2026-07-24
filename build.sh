#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
DEVCONTAINER_DIR="$SCRIPT_DIR/.devcontainer"
IMAGE_TAG="latex-docker-build"
FORCE_REBUILD=0
TEX_DIR=""
TEX_FILE=""

# By default bash needs two Tab presses before it lists matches (the first
# just fills in the unambiguous part and beeps); show the list on the first
# press instead, and don't page long listings, so `read -e` below feels like
# normal shell completion.
bind 'set show-all-if-ambiguous on' 2>/dev/null || true
bind 'set page-completions off' 2>/dev/null || true

usage() {
    cat <<'USAGE'
Usage:
  ./build.sh                              interactive prompts
  ./build.sh -d DIR -f FILE.tex           non-interactive
  ./build.sh -d DIR -f FILE.tex --rebuild force a fresh image build

Options:
  -d, --dir DIR       Directory containing the .tex file
  -f, --file FILE     Name of the .tex file (extension optional)
  -t, --tag TAG       Docker image tag to use/build (default: latex-docker-build)
  -r, --rebuild       Force rebuild of the Docker image even if it exists
  -h, --help          Show this help message
USAGE
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -d|--dir)     TEX_DIR="$2"; shift 2 ;;
        -f|--file)    TEX_FILE="$2"; shift 2 ;;
        -t|--tag)     IMAGE_TAG="$2"; shift 2 ;;
        -r|--rebuild) FORCE_REBUILD=1; shift ;;
        -h|--help)    usage ;;
        *) echo "Unknown option: $1" >&2; usage ;;
    esac
done

if [[ -z "$TEX_DIR" && -z "$TEX_FILE" ]]; then
    # Tab-completion naturally runs past the directory and into the file
    # itself, so accept a full path here instead of asking for the directory
    # in isolation - split it into dir/file afterward.
    read -e -rp "Path to the .tex file (or its directory): " TEX_PATH
    TEX_PATH="${TEX_PATH/#\~/$HOME}"
    if [[ -d "$TEX_PATH" ]]; then
        TEX_DIR="$TEX_PATH"
    else
        TEX_DIR="$(dirname -- "$TEX_PATH")"
        TEX_FILE="$(basename -- "$TEX_PATH")"
    fi
elif [[ -z "$TEX_DIR" ]]; then
    read -e -rp "Directory containing the .tex file: " TEX_DIR
fi
TEX_DIR="${TEX_DIR/#\~/$HOME}"
if [[ ! -d "$TEX_DIR" ]]; then
    echo "Error: directory '$TEX_DIR' does not exist." >&2
    exit 1
fi
TEX_DIR="$(cd "$TEX_DIR" && pwd)"
cd "$TEX_DIR"

if [[ -z "$TEX_FILE" ]]; then
    read -e -rp "Name of the .tex file (e.g. paper.tex): " TEX_FILE
fi
[[ "$TEX_FILE" == *.tex ]] || TEX_FILE="${TEX_FILE}.tex"

if [[ ! -f "$TEX_DIR/$TEX_FILE" ]]; then
    echo "Error: '$TEX_DIR/$TEX_FILE' not found." >&2
    exit 1
fi

if [[ "$FORCE_REBUILD" -eq 1 ]] || ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
    echo "Building image '$IMAGE_TAG' from $DEVCONTAINER_DIR ..."
    docker build -t "$IMAGE_TAG" -f "$DEVCONTAINER_DIR/Dockerfile" "$DEVCONTAINER_DIR"
else
    echo "Using existing image '$IMAGE_TAG'."
fi

echo "Compiling '$TEX_FILE' in '$TEX_DIR' ..."
docker run --rm -v "$TEX_DIR":/workspace -w /workspace "$IMAGE_TAG" \
    latexmk -pdf -interaction=nonstopmode -halt-on-error "$TEX_FILE"

PDF_FILE="${TEX_FILE%.tex}.pdf"
if [[ -f "$TEX_DIR/$PDF_FILE" ]]; then
    echo "Done: $TEX_DIR/$PDF_FILE"
else
    echo "Build finished but '$PDF_FILE' was not found - check the log above." >&2
    exit 1
fi

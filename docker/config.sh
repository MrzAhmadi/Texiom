# Shared by the texiom CLI and the GitHub Action entrypoint (installed in the
# image as /usr/local/lib/texiom-config.sh). Expects TEX_FILE, ENGINE,
# PDF_ONLY, WATCH, SHELL_ESCAPE, APT_PKGS and PIP_PKGS to be defined.

# Per-project settings: an optional texiom.toml next to the .tex file. Only a
# flat subset of TOML is read (key = "string" / true / false / ["a", "b"],
# # comments);
# command-line flags win over the file (apt/pip lists are combined).
load_config() {
    local conf="${1:-.}/texiom.toml" line key val
    [[ -f "$conf" ]] || return 0
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%%#*}"
        [[ "$line" == *=* ]] || continue
        key="${line%%=*}"; val="${line#*=}"
        key="$(echo "$key" | tr -d '[:space:]')"
        if [[ "$val" =~ ^[[:space:]]*\[ ]]; then
            while [[ "$val" != *']'* ]] && IFS= read -r line; do
                val+=" ${line%%#*}"
            done
            val="$(echo "$val" | tr -d '[]"'"'"'' | tr ',' ' ')"
        fi
        val="$(echo "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/')"
        case "$key" in
            file)     [[ -n "$TEX_FILE" ]] || TEX_FILE="$val" ;;
            engine)   [[ -n "$ENGINE" ]] || ENGINE="$val" ;;
            pdf_only) [[ "$val" != true ]] || PDF_ONLY=1 ;;
            watch)    [[ "$val" != true ]] || WATCH=1 ;;
            shell_escape) [[ "$val" != true ]] || SHELL_ESCAPE=1 ;;
            apt)      APT_PKGS+=" $val" ;;
            pip)      PIP_PKGS+=" $val" ;;
            *) echo "Warning: unknown key '$key' in $conf" >&2 ;;
        esac
    done < "$conf"
}

# Rejects package names that could inject extra shell/Dockerfile syntax.
validate_packages() {
    local pkg
    for pkg in "$@"; do
        if [[ ! "$pkg" =~ ^[A-Za-z0-9][A-Za-z0-9._+:=~-]*$ ]]; then
            echo "Error: invalid package name '$pkg'." >&2
            exit 1
        fi
    done
}

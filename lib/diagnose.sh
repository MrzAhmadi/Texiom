# shellcheck shell=bash
# After a failed build: say plainly when the cause is a LaTeX package or tool that is not installed,
# and name the pack that provides it (sourced by texiom). Expects DOCKER_DIR/SCRIPT_DIR.

PACK_INDEX="${TEXIOM_PACK_INDEX:-$SCRIPT_DIR/lib/pack-index.tsv}"

# File extensions TeX loads as packages/styles; other missing files are the user's own.
PACKAGE_FILE_PATTERN='\.(sty|cls|clo|bst|bbx|cbx|lbx|def|fd|ldf|cfg)$'

# Pack that provides a TeX file name, or nothing if the index does not know it.
pack_for_file() {
    [[ -f "$PACK_INDEX" ]] || return 0
    awk -F'\t' -v f="$1" '$1 == f {print $2; exit}' "$PACK_INDEX"
}

# Prints the explanation for a failed build log ($1) and sets MISSING_PACKS to the packs that
# would fix it (space-separated, may be empty).
diagnose_failure() {
    local log="$1" file pack hints=()
    MISSING_PACKS=""
    declare -A wanted=()

    while IFS= read -r file; do
        [[ -n "$file" ]] || continue
        if [[ "$file" =~ $PACKAGE_FILE_PATTERN ]]; then
            pack="$(pack_for_file "$file")"
            if [[ -n "$pack" ]]; then
                hints+=("LaTeX package '$file' is not installed. It is provided by the pack '$pack'.")
                wanted[$pack]=1
            else
                hints+=("'$file' was not found. If it is your own file, check its path; otherwise it is not in any pack - try: texiom add full")
            fi
        fi
    done < <(sed -n "s/.*File [\`']\\([^']*\\)' not found.*/\\1/p" "$log" | sort -u)

    if grep -qiE "pygmentize|You must have .pygmentize. installed" "$log"; then
        hints+=("The minted package needs pygments, which is not installed. It is provided by the pack 'minted'.")
        wanted[minted]=1
    fi
    if grep -qE "(inkscape: (command )?not found|inkscape: No such file)" "$log"; then
        hints+=("\\includesvg needs inkscape, which is not installed. It is provided by the pack 'inkscape'.")
        wanted[inkscape]=1
    fi
    if grep -qE "gnuplot: (command )?not found" "$log"; then
        hints+=("A plot needs gnuplot, which is not installed. It is provided by the pack 'gnuplot'.")
        wanted[gnuplot]=1
    fi
    if grep -qE "(fontspec|luaotfload).*(font|Font).*(cannot be found|not found)" "$log"; then
        hints+=("A font was not found. Extra fonts are in the pack 'fonts-extra'; your own fonts must be inside the project directory.")
        wanted[fonts-extra]=1
    fi

    [[ ${#hints[@]} -gt 0 ]] || return 0
    echo >&2
    echo "The build failed because something is not installed:" >&2
    printf '  - %s\n' "${hints[@]}" >&2
    MISSING_PACKS="$(printf '%s\n' "${!wanted[@]}" | sort | paste -sd' ')"
    if [[ -n "$MISSING_PACKS" ]]; then
        echo "Install with: texiom add $MISSING_PACKS" >&2
    fi
}

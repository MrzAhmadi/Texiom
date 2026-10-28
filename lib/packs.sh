# shellcheck shell=bash
# Packs: optional extras on top of the slim base image (sourced by texiom).
#   catalogue  - docker/packs.conf (name, group, description, Ubuntu packages)
#   selection  - ~/.config/texiom/packs, one name per line; installed once, used for every project
# `texiom packs` only reads these two files; add/remove also need the image (IMAGE_TAG, RUN_IMAGE).
# Expects DOCKER_DIR.

PACKS_CONF="${TEXIOM_PACKS_CONF:-$DOCKER_DIR/packs.conf}"
PACKS_FILE="${TEXIOM_PACKS_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/texiom/packs}"
PACK_GROUPS="Packages Fonts Tools Languages Everything"

pack_names() {
    awk -F'\t' '!/^#/ && NF >= 4 {print $1}' "$PACKS_CONF"
}

# pack_field NAME COLUMN (1 name, 2 group, 3 description, 4 apt packages)
pack_field() {
    awk -F'\t' -v n="$1" -v f="$2" '!/^#/ && $1 == n {print $f; exit}' "$PACKS_CONF"
}

pack_exists() {
    [[ -n "$(pack_field "$1" 1)" ]]
}

# Union of the apt packages of the given pack names.
packs_apt_packages() {
    local name
    for name in "$@"; do pack_field "$name" 4; done | tr ' ' '\n' | sort -u | paste -sd' '
}

# Installed (selected) pack names, sorted. Names the catalogue no longer knows are ignored.
packs_installed() {
    [[ -f "$PACKS_FILE" ]] || return 0
    local name
    while read -r name || [[ -n "$name" ]]; do
        [[ -n "$name" && "$name" != \#* ]] || continue
        if pack_exists "$name"; then echo "$name"; fi
    done < "$PACKS_FILE" | sort -u
}

packs_save() {
    mkdir -p "$(dirname "$PACKS_FILE")"
    printf '%s\n' "$@" | sort -u | sed '/^$/d' > "$PACKS_FILE"
}

# Prints the catalogue, grouped; installed packs are marked [x]. Needs no Docker.
cmd_packs() {
    local installed group name grp desc mark
    installed="$(packs_installed)"
    echo "Packs add LaTeX packages and tools to the base image.   [x] installed"
    for group in $PACK_GROUPS; do
        echo
        echo "$group"
        while IFS=$'\t' read -r name grp desc _; do
            [[ "$grp" == "$group" ]] || continue
            mark="[ ]"
            if grep -qx "$name" <<<"$installed"; then mark="[x]"; fi
            printf '  %s %-16s %s\n' "$mark" "$name" "$desc"
        done < <(awk -F'\t' '!/^#/ && NF >= 4' "$PACKS_CONF")
    done
    echo
    echo "Install:  texiom add <pack> [<pack> ...]      Remove:  texiom remove <pack> ..."
}

# Numbered pick list on stdout; the chosen names are printed on one line.
pick_packs() {
    local candidates=("$@") i answer token chosen=()
    [[ ${#candidates[@]} -gt 0 ]] || return 0
    local group last_group=""
    for i in "${!candidates[@]}"; do
        group="$(pack_field "${candidates[$i]}" 2)"
        if [[ "$group" != "$last_group" ]]; then
            printf '%s\n' "$group" >&2
            last_group="$group"
        fi
        printf '  %2d) %-18s %s\n' "$((i + 1))" "${candidates[$i]}" "$(pack_field "${candidates[$i]}" 3)" >&2
    done
    read -e -r -p "Packs (numbers or names, space-separated; empty to cancel): " answer || true
    for token in $answer; do
        if [[ "$token" =~ ^[0-9]+$ ]] && (( token >= 1 && token <= ${#candidates[@]} )); then
            chosen+=("${candidates[$((token - 1))]}")
        else
            chosen+=("$token")
        fi
    done
    echo "${chosen[*]:-}"
}

cmd_add() {
    local names=("$@") installed new=() name
    installed="$(packs_installed)"
    if [[ ${#names[@]} -eq 0 ]]; then
        if [[ -t 0 && -t 1 ]]; then
            mapfile -t _avail < <(pack_names | grep -vxF "$installed" || true)
            read -r -a names <<<"$(pick_packs "${_avail[@]}")"
        fi
        if [[ ${#names[@]} -eq 0 ]]; then
            echo "Usage: texiom add <pack> [<pack> ...]   (see: texiom packs)" >&2
            return 1
        fi
    fi
    for name in "${names[@]}"; do
        if ! pack_exists "$name"; then
            echo "Unknown pack '$name'. See: texiom packs" >&2
            return 1
        fi
        if grep -qx "$name" <<<"$installed"; then
            echo "Already installed: $name"
        else
            new+=("$name")
        fi
    done
    [[ ${#new[@]} -gt 0 ]] || return 0

    # shellcheck disable=SC2046
    ensure_packs_image $(printf '%s\n' $installed "${new[@]}" | sort -u)
    # shellcheck disable=SC2046
    packs_save $(printf '%s\n' $installed "${new[@]}")
    echo "Installed: ${new[*]}"
}

cmd_remove() {
    local names=("$@") installed keep name
    installed="$(packs_installed)"
    if [[ -z "$installed" ]]; then
        echo "No packs are installed."
        return 0
    fi
    if [[ ${#names[@]} -eq 0 ]]; then
        if [[ -t 0 && -t 1 ]]; then
            mapfile -t _have <<<"$installed"
            read -r -a names <<<"$(pick_packs "${_have[@]}")"
        fi
        if [[ ${#names[@]} -eq 0 ]]; then
            echo "Usage: texiom remove <pack> [<pack> ...]" >&2
            return 1
        fi
    fi
    keep="$installed"
    for name in "${names[@]}"; do
        if ! grep -qx "$name" <<<"$installed"; then
            echo "Not installed: $name" >&2
            return 1
        fi
        keep="$(grep -vx "$name" <<<"$keep" || true)"
    done
    [[ -z "$keep" ]] || echo "The remaining packs are reinstalled on the base image."
    # shellcheck disable=SC2086
    ensure_packs_image $keep
    # shellcheck disable=SC2086
    packs_save $keep
    echo "Removed: ${names[*]}"
}

_texiom_completions() {
    local cur prev
    _init_completion || return

    local long_opts="--dir --file --tag --rebuild --no-pull --shell-escape --apt --pip --engine --pdf-only --watch --version --help"
    local short_opts="-d -f -t -r -E -p -w -v -h"

    # Subcommand: packs / add / remove (first non-option word)
    local word subcommand="" i
    for ((i = 1; i < COMP_CWORD; i++)); do
        word="${COMP_WORDS[i]}"
        case "$word" in
            packs|add|remove) subcommand="$word"; break ;;
        esac
    done
    if [[ "$subcommand" == add || "$subcommand" == remove ]] && [[ "$cur" != -* ]]; then
        local root conf
        root="$(dirname "$(readlink -f "$(command -v texiom)")")"
        conf="$root/docker/packs.conf"
        if [[ "$subcommand" == add ]]; then
            COMPREPLY=($(compgen -W "$(awk -F'\t' '!/^#/ && NF >= 4 {print $1}' "$conf" 2>/dev/null)" -- "$cur"))
        else
            COMPREPLY=($(compgen -W "$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/texiom/packs" 2>/dev/null)" -- "$cur"))
        fi
        return
    fi

    case "$prev" in
        -d|--dir)
            _filedir -d
            return
            ;;
        -f|--file)
            local dir="."
            local i
            for ((i = 1; i < ${#COMP_WORDS[@]} - 1; i++)); do
                if [[ "${COMP_WORDS[i]}" == "-d" || "${COMP_WORDS[i]}" == "--dir" ]]; then
                    dir="${COMP_WORDS[i+1]}"
                    break
                fi
            done
            if [[ -d "$dir" ]]; then
                pushd "$dir" >/dev/null 2>&1
                _filedir tex
                popd >/dev/null 2>&1
            else
                _filedir tex
            fi
            return
            ;;
        -E|--engine)
            COMPREPLY=($(compgen -W "pdflatex xelatex lualatex" -- "$cur"))
            return
            ;;
        -t|--tag)
            COMPREPLY=($(compgen -W "$(docker images --format '{{.Repository}}' 2>/dev/null | sort -u)" -- "$cur"))
            return
            ;;
    esac

    if [[ -z "$subcommand" && "$cur" != -* ]]; then
        COMPREPLY=($(compgen -W "packs add remove" -- "$cur"))
        return
    fi
    COMPREPLY=($(compgen -W "$long_opts $short_opts" -- "$cur"))
} &&
complete -F _texiom_completions texiom

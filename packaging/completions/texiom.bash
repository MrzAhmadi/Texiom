_texiom_completions() {
    local cur prev
    _init_completion || return

    local long_opts="--dir --file --tag --rebuild --pdf-only --watch --edit --version --help"
    local short_opts="-d -f -t -r -p -w -e -v -h"

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
        -t|--tag)
            COMPREPLY=($(compgen -W "$(docker images --format '{{.Repository}}' 2>/dev/null | sort -u)" -- "$cur"))
            return
            ;;
    esac

    COMPREPLY=($(compgen -W "$long_opts $short_opts" -- "$cur"))
} &&
complete -F _texiom_completions texiom

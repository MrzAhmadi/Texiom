# shellcheck shell=bash
# Image handling for the texiom CLI (sourced by texiom and by CI):
#   base image  - slim, downloaded from GHCR when it matches this install, otherwise built locally
#   packs layer - the user's globally installed packs on top of the base (see packs.sh)
#   extras layer - per-project --apt/--pip packages on top of that
# Expects DOCKER_DIR, VERSION, IMAGE_TAG, REGISTRY_IMAGE, FORCE_REBUILD, NO_PULL where noted.

# Hash of everything that goes into the image. Relative paths and a C-locale sort keep it
# identical on every machine and in CI, so a prebuilt image can be matched without pulling it.
docker_context_hash() {
    (cd "$1" && find docker -type f -print0 | LC_ALL=C sort -z \
        | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
}

image_label() {
    docker image inspect --format "{{ index .Config.Labels \"$2\" }}" "$1" 2>/dev/null || true
}

image_id() {
    docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true
}

# Reads the build hash baked into a published image without downloading it (a few KB instead of
# hundreds of MB). Prints nothing on any failure; callers then fall back to pulling and comparing.
remote_image_hash() {
    command -v curl >/dev/null 2>&1 || return 0
    local ref="$1" repo tag token manifest digest
    repo="${ref#ghcr.io/}"; repo="${repo%%:*}"
    tag="${ref##*:}"
    token="$(curl -fsS --max-time 15 "https://ghcr.io/token?scope=repository:${repo}:pull" 2>/dev/null \
        | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)" || return 0
    [[ -n "$token" ]] || return 0
    manifest="$(curl -fsS --max-time 15 -H "Authorization: Bearer $token" \
        -H "Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json" \
        "https://ghcr.io/v2/${repo}/manifests/${tag}" 2>/dev/null)" || return 0
    digest="$(printf '%s' "$manifest" | tr -d '\n ' | grep -o '"config":{[^}]*"digest":"sha256:[0-9a-f]*"' | grep -o 'sha256:[0-9a-f]*')" || return 0
    [[ -n "$digest" ]] || return 0
    curl -fsSL --max-time 15 -H "Authorization: Bearer $token" \
        "https://ghcr.io/v2/${repo}/blobs/${digest}" 2>/dev/null \
        | grep -o '"texiom.dockerhash":"[0-9a-f]*"' | head -1 | cut -d'"' -f4 || true
}

build_base_image() {
    echo "Building base image '$IMAGE_TAG' locally (this takes a few minutes) ..."
    docker build --target slim \
        --build-arg "TEXIOM_VERSION=$VERSION" \
        --build-arg "TEXIOM_DOCKER_HASH=$DOCKER_HASH" \
        -t "$IMAGE_TAG" -f "$DOCKER_DIR/Dockerfile" "$DOCKER_DIR"
}

# Makes sure $IMAGE_TAG is the slim base for this install: reuse it, download the matching
# prebuilt image, or build it locally.
ensure_base_image() {
    if [[ "$FORCE_REBUILD" -eq 0 && "$(image_label "$IMAGE_TAG" texiom.dockerhash)" == "$DOCKER_HASH" ]]; then
        return 0
    fi
    if [[ "$FORCE_REBUILD" -eq 1 || "$NO_PULL" -eq 1 ]]; then
        build_base_image
        return
    fi
    local remote_hash
    remote_hash="$(remote_image_hash "$REGISTRY_IMAGE")"
    if [[ -n "$remote_hash" && "$remote_hash" != "$DOCKER_HASH" ]]; then
        echo "The published image is for a different version than this install."
        build_base_image
        return
    fi
    echo "Downloading base image $REGISTRY_IMAGE ..."
    if docker pull "$REGISTRY_IMAGE" >&2 \
            && [[ "$(image_label "$REGISTRY_IMAGE" texiom.dockerhash)" == "$DOCKER_HASH" ]]; then
        docker tag "$REGISTRY_IMAGE" "$IMAGE_TAG"
        echo "Base image ready. Need more LaTeX packages? See: texiom packs"
    else
        echo "Could not use the published image."
        build_base_image
    fi
}

# Tag of the layer holding the globally installed packs.
packs_image_tag() {
    echo "${IMAGE_TAG%%:*}-packs:installed"
}

# Space-separated names in $1 that are not in $2.
names_minus() {
    comm -23 <(tr ' ' '\n' <<<"$1" | sort -u) <(tr ' ' '\n' <<<"$2" | sort -u) | paste -sd' '
}

# Brings the packs layer in line with the wanted pack names ($@, sorted) and sets RUN_IMAGE.
# Reuses the current layer when nothing changed, adds only the new packs when the base is
# unchanged and nothing was removed, and reinstalls everything on top of the base otherwise.
ensure_packs_image() {
    local want="$*" tag base_id cur cur_base from add
    tag="$(packs_image_tag)"
    base_id="$(image_id "$IMAGE_TAG")"
    RUN_IMAGE="$IMAGE_TAG"
    if [[ -z "$want" ]]; then
        # Nothing wanted: a layer left over from an earlier selection is dropped.
        [[ -z "$(image_id "$tag")" ]] || docker rmi "$tag" >/dev/null 2>&1 || true
        return 0
    fi
    cur="$(image_label "$tag" texiom.packs)"
    cur_base="$(image_label "$tag" texiom.base)"
    if [[ "$cur_base" == "$base_id" && "$cur" == "$want" ]]; then
        RUN_IMAGE="$tag"
        return 0
    fi

    if [[ -n "$cur" && "$cur_base" == "$base_id" && -z "$(names_minus "$cur" "$want")" ]]; then
        from="$tag"; add="$(names_minus "$want" "$cur")"
    else
        from="$IMAGE_TAG"; add="$want"
        if [[ -n "$cur" && "$cur_base" != "$base_id" ]]; then
            echo "The base image changed; reinstalling your packs: $want"
        fi
    fi

    echo "Installing packs: $add ..."
    {
        echo "FROM $from"
        echo "RUN apt-get update && apt-get install -y --no-install-recommends $(packs_apt_packages $add) && rm -rf /var/lib/apt/lists/*"
        echo "LABEL texiom.packs=\"$want\" texiom.base=\"$base_id\""
    } | docker build -t "$tag" -
    RUN_IMAGE="$tag"
}

# Per-project extras (--apt / --pip / texiom.toml): a small layer on top of RUN_IMAGE, tagged by
# the image it sits on plus the package lists, so it is built once.
build_extras_image() {
    local apt pip spec extras_tag
    apt="$(echo $APT_PKGS)"; pip="$(echo $PIP_PKGS)"
    [[ -n "$apt$pip" ]] || return 0
    validate_packages $apt $pip
    spec="$(printf '%s|%s|%s' "$(image_id "$RUN_IMAGE")" "$apt" "$pip" | sha256sum | cut -c1-12)"
    extras_tag="${IMAGE_TAG%%:*}-extras:$spec"
    if ! docker image inspect "$extras_tag" >/dev/null 2>&1; then
        echo "Building image with extra packages (apt: ${apt:-none}; pip: ${pip:-none}) ..."
        {
            echo "FROM $RUN_IMAGE"
            [[ -z "$apt" ]] || echo "RUN apt-get update && apt-get install -y $apt && rm -rf /var/lib/apt/lists/*"
            # pip is not part of the base image; it is installed only when a project asks for Python packages
            [[ -z "$pip" ]] || echo "RUN apt-get update && apt-get install -y --no-install-recommends python3-pip && rm -rf /var/lib/apt/lists/* && pip3 install --break-system-packages --no-cache-dir $pip"
        } | docker build -t "$extras_tag" -
    fi
    RUN_IMAGE="$extras_tag"
}

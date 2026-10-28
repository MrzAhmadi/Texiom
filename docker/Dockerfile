# Two published variants share one build:
#   slim - small base (core LaTeX, XeTeX, LuaTeX, biblatex, biber); extras are added as packs (see packs.conf)
#   full - every TeX Live collection (like texlive-full, minus the documentation); last stage = default target
#
# The heavy apt layers sit in their own stages and the small app files are copied last,
# so editing scripts or the editor never invalidates the cached TeX Live layers.
# Stage order matters: the legacy (non-BuildKit) builder builds every stage before the target.

FROM ubuntu:24.04 AS tex-base

ENV DEBIAN_FRONTEND=noninteractive

COPY base.packages /tmp/base.packages
RUN apt-get update \
    && grep -v '^#' /tmp/base.packages | xargs apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* /tmp/base.packages

RUN pip3 install --break-system-packages --no-cache-dir fastapi "uvicorn[standard]"


FROM tex-base AS slim

COPY action-entrypoint.sh /usr/local/bin/texiom-action-entrypoint
COPY config.sh /usr/local/lib/texiom-config.sh
COPY editor/ /opt/texiom-editor/
RUN chmod +x /usr/local/bin/texiom-action-entrypoint

ARG TEXIOM_VERSION=unknown
ARG TEXIOM_DOCKER_HASH=unknown
LABEL texiom.version="${TEXIOM_VERSION}" \
      texiom.dockerhash="${TEXIOM_DOCKER_HASH}" \
      texiom.variant="slim"

WORKDIR /workspace
CMD ["bash"]


FROM tex-base AS tex-full

COPY packs.conf /tmp/packs.conf
RUN apt-get update \
    && awk -F'\t' '$1 == "full" {print $4}' /tmp/packs.conf \
       | xargs apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* /tmp/packs.conf


FROM tex-full AS full

COPY action-entrypoint.sh /usr/local/bin/texiom-action-entrypoint
COPY config.sh /usr/local/lib/texiom-config.sh
COPY editor/ /opt/texiom-editor/
RUN chmod +x /usr/local/bin/texiom-action-entrypoint

ARG TEXIOM_VERSION=unknown
ARG TEXIOM_DOCKER_HASH=unknown
LABEL texiom.version="${TEXIOM_VERSION}" \
      texiom.dockerhash="${TEXIOM_DOCKER_HASH}" \
      texiom.variant="full"

WORKDIR /workspace
CMD ["bash"]

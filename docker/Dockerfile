FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    texlive-full \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y \
    biber \
    latexmk \
    make \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir fastapi "uvicorn[standard]"

COPY action-entrypoint.sh /usr/local/bin/texiom-action-entrypoint
RUN chmod +x /usr/local/bin/texiom-action-entrypoint

COPY editor/ /opt/texiom-editor/

ARG TEXIOM_VERSION=unknown
ARG TEXIOM_DOCKER_HASH=unknown
LABEL texiom.version="${TEXIOM_VERSION}"
LABEL texiom.dockerhash="${TEXIOM_DOCKER_HASH}"

WORKDIR /workspace

CMD ["bash"]

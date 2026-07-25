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

RUN pip3 install --break-system-packages --no-cache-dir fastapi uvicorn

COPY action-entrypoint.sh /usr/local/bin/latexbuild-action-entrypoint
RUN chmod +x /usr/local/bin/latexbuild-action-entrypoint

COPY editor/ /opt/latexbuild-editor/

ARG LATEXBUILD_VERSION=unknown
ARG LATEXBUILD_DOCKER_HASH=unknown
LABEL latexbuild.version="${LATEXBUILD_VERSION}"
LABEL latexbuild.dockerhash="${LATEXBUILD_DOCKER_HASH}"

WORKDIR /workspace

CMD ["bash"]

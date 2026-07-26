FROM texlive/texlive:latest-medium

ENV DEBIAN_FRONTEND=noninteractive

RUN success=0; \
    for attempt in 1 2 3 4 5; do \
      if tlmgr install ieeetran moderncv fontawesome6; then success=1; break; fi; \
      echo "tlmgr install attempt $attempt failed, retrying in 20s..." >&2; \
      sleep 20; \
    done; \
    [ "$success" = "1" ]

RUN apt-get update && apt-get install -y \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir fastapi "uvicorn[standard]"

COPY action-entrypoint.sh /usr/local/bin/latexbuild-action-entrypoint
RUN chmod +x /usr/local/bin/latexbuild-action-entrypoint

COPY editor/ /opt/latexbuild-editor/

ARG LATEXBUILD_VERSION=unknown
ARG LATEXBUILD_DOCKER_HASH=unknown
LABEL latexbuild.version="${LATEXBUILD_VERSION}"
LABEL latexbuild.dockerhash="${LATEXBUILD_DOCKER_HASH}"

WORKDIR /workspace

CMD ["bash"]

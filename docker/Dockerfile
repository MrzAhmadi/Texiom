FROM texlive/texlive:latest-medium

ENV DEBIAN_FRONTEND=noninteractive

# scheme-medium doesn't include every document class; add the ones known to be
# needed here. tlmgr makes it cheap to extend this list if another is missing.
RUN tlmgr install ieeetran moderncv fontawesome6

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

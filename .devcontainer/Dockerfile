FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    texlive-full \
    biber \
    latexmk \
    make \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY action-entrypoint.sh /usr/local/bin/latexbuild-action-entrypoint
RUN chmod +x /usr/local/bin/latexbuild-action-entrypoint

WORKDIR /workspace

CMD ["bash"]

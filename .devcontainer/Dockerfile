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

WORKDIR /workspace

CMD ["bash"]

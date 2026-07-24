# latex-docker-build

Compile any `.tex` file into a PDF using a containerized, full TeX Live
distribution — no LaTeX installation required on the host machine.

## Why

Installing a full TeX Live distribution locally is slow, large, and easy to
get out of sync across machines. This project packages `texlive-full`,
`latexmk`, and `biber` into a single Docker image (also usable as a VS Code
Dev Container) and provides a small script that compiles any `.tex` file on
your host by mounting its directory into the container.

## Requirements

- [Docker](https://docs.docker.com/get-docker/)
- Bash

No LaTeX distribution needs to be installed on the host.

## Usage

Clone the repository, then run the build script from anywhere:

```bash
./build.sh
```

It will interactively ask for:

```
Directory containing the .tex file: /path/to/your/project
Name of the .tex file (e.g. paper.tex): paper.tex
```

Or run it non-interactively:

```bash
./build.sh --dir /path/to/your/project --file paper.tex
```

The resulting `paper.pdf` (and all `latexmk` auxiliary files) will appear
next to `paper.tex` in the original directory.

### Options

| Flag             | Description                                              |
|------------------|-----------------------------------------------------------|
| `-d, --dir DIR`  | Directory containing the `.tex` file                      |
| `-f, --file FILE`| Name of the `.tex` file (`.tex` extension optional)        |
| `-t, --tag TAG`  | Docker image tag to use/build (default: `latex-docker-build`) |
| `-r, --rebuild`  | Force a fresh image build even if one already exists      |
| `-h, --help`     | Show usage                                                 |

The first run builds the Docker image (a few minutes, since `texlive-full`
is a large distribution); every run after that reuses the cached image, so
compilation is fast.

## Using as a VS Code Dev Container

Open this folder (or any project that references this `.devcontainer/`) in
VS Code with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
and choose "Reopen in Container" for an interactive environment with the
LaTeX Workshop extension pre-configured to build on save.

## What's inside the image

- Ubuntu 24.04
- `texlive-full` (covers `moderncv`, `biblatex`/`biber`, IEEE conference
  classes, `tcolorbox`, `mdframed`, and virtually any other LaTeX package)
- `latexmk`, `biber`, `make`, `git`

## License

MIT

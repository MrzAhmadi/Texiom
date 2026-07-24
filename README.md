# texbuild

Compile any `.tex` file into a PDF using a containerized, full TeX Live
distribution — no LaTeX installation required on the host machine.

## Why

Installing a full TeX Live distribution locally is slow, large, and easy to
get out of sync across machines. This project packages `texlive-full`,
`latexmk`, and `biber` into a single Docker image (also usable as a VS Code
Dev Container) and provides a small `texbuild` command that compiles any
`.tex` file on your host by mounting its directory into the container.

## Requirements

- [Docker](https://docs.docker.com/get-docker/)
- Bash

No LaTeX distribution needs to be installed on the host.

## Installation

Download the latest release from the
[Releases page](https://github.com/MrzAhmadi/latex-docker-build/releases).

**Debian / Ubuntu:**

```bash
sudo dpkg -i texbuild_*.deb
```

**Fedora / RHEL:**

```bash
sudo rpm -i texbuild-*.rpm
```

**Any other Linux (generic tarball):**

```bash
tar -xzf texbuild-*-linux.tar.gz
cd texbuild-*/
sudo ./install.sh
```

Each of these installs a `texbuild` command onto your `PATH`, usable from
any directory.

**Running from a git checkout without installing:**

```bash
git clone https://github.com/MrzAhmadi/latex-docker-build.git
cd latex-docker-build
./texbuild
```

## Usage

```bash
texbuild
```

It will interactively ask for the path to your `.tex` file (tab-completion
works, so you can navigate straight to it):

```
Path to the .tex file (or its directory): /path/to/your/project/paper.tex
```

Or run it non-interactively:

```bash
texbuild --dir /path/to/your/project --file paper.tex
```

The resulting `paper.pdf` (and all `latexmk` auxiliary files) will appear
next to `paper.tex` in the original directory. Pass `--pdf-only` if you
just want the `.pdf` and none of the auxiliary files.

To rebuild automatically every time you save the file, pass `--watch`:

```bash
texbuild --dir /path/to/your/project --file paper.tex --watch
```

This keeps running in the foreground and recompiles on every change to
`paper.tex` (or anything it includes) until you press Ctrl+C.

### Options

| Flag              | Description                                                |
|-------------------|-------------------------------------------------------------|
| `-d, --dir DIR`   | Directory containing the `.tex` file                       |
| `-f, --file FILE` | Name of the `.tex` file (`.tex` extension optional)         |
| `-t, --tag TAG`   | Docker image tag to use/build (default: `texbuild`)         |
| `-r, --rebuild`   | Force a fresh image build even if one already exists        |
| `-p, --pdf-only`  | Remove `latexmk`'s auxiliary files after a successful build, leaving only the `.pdf` |
| `-w, --watch`     | Rebuild automatically whenever the `.tex` file changes, until Ctrl+C |
| `-v, --version`   | Show the installed version                                  |
| `-h, --help`      | Show usage                                                   |

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

## Releases

Pushing to `main` builds and publishes `.deb`, `.rpm`, and `.tar.gz`
packages via GitHub Actions, tagged with the version in the [`VERSION`](VERSION)
file.

## Contributing

Issues and pull requests are welcome.

## License

MIT

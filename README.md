<p align="center">
  <img src="assets/logo.png" alt="Texiom logo" width="160">
</p>

# Texiom

**Texiom** is a Docker-based LaTeX compiler. Build any
`.tex` file into a PDF with `pdflatex`, `xelatex` or `lualatex` - no TeX Live
installation required on your machine.

**Website:** https://mrzahmadi.github.io/Texiom/

[![Release](https://img.shields.io/github/v/release/MrzAhmadi/Texiom)](https://github.com/MrzAhmadi/Texiom/releases)
[![License: MIT](https://img.shields.io/github/license/MrzAhmadi/Texiom)](LICENSE)
[![Stars](https://img.shields.io/github/stars/MrzAhmadi/Texiom?style=flat)](https://github.com/MrzAhmadi/Texiom/stargazers)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20WSL2-blue)
![Docker](https://img.shields.io/badge/requires-Docker-2496ED?logo=docker&logoColor=white)

## Features

- **No local LaTeX install** - a Docker image with TeX Live, `latexmk` and `biber` does the work.
- **Small first download** - the base image is roughly 330 MB; add what you need with `texiom add` (science, publisher templates, fonts, languages, ...) and never download it twice.
- **Clear errors** - when a build fails because a package or tool is not installed, Texiom says which one and which pack provides it.
- **Three engines** - `pdflatex`, `xelatex` and `lualatex` (for `fontspec` and custom fonts).
- **Watch mode** - `texiom --watch` rebuilds on every save, so you can write in any editor.
- **Clean output** - `--pdf-only` leaves just the PDF.
- **Packages for Linux** - `.deb`, `.rpm` and a generic tarball.
- **GitHub Action** - build LaTeX PDFs in CI with `MrzAhmadi/Texiom@main`.
- **VS Code Dev Container** - LaTeX Workshop preconfigured.

## Quick start

```bash
sudo dpkg -i texiom_*.deb      # install from the Releases page (see below for rpm/tarball)
texiom --dir ~/my-paper --file paper.tex
texiom packs                   # see the optional extras (packages, fonts, languages)
```

## Why Texiom

Installing a full TeX Live distribution locally is slow, large, and easy to
get out of sync across machines. Texiom packages TeX Live, `latexmk` and
`biber` into Docker images (also usable as a VS Code Dev Container) and
provides a small `texiom` command that compiles any `.tex` file on your host
by mounting its directory into the container.

The default image is deliberately small - core LaTeX, XeTeX, LuaTeX, biblatex
and biber - so the first run is quick. Everything else is an optional
[pack](#packs-extra-latex-packages-and-tools) that you install once, on demand.

## Requirements

- [Docker](https://docs.docker.com/get-docker/)
- Bash

No LaTeX distribution needs to be installed on the host.

**On Windows:** there's no native Windows build - use
[WSL2](https://learn.microsoft.com/windows/wsl/install) instead. Docker
Desktop already requires WSL2 for Linux containers, so this isn't an
extra dependency: install Docker Desktop, enable WSL2 integration for
your distro (Settings → Resources → WSL Integration), then open that
distro's terminal (e.g. Ubuntu) and follow the Linux instructions below
exactly as written - `texiom` runs unmodified there.

## Installation

Download the latest release from the
[Releases page](https://github.com/MrzAhmadi/Texiom/releases).

**Debian / Ubuntu:**

```bash
sudo dpkg -i texiom_*.deb
```

**Fedora / RHEL:**

```bash
sudo rpm -i texiom-*.rpm
```

**Any other Linux (generic tarball):**

```bash
tar -xzf texiom-*-linux.tar.gz
cd texiom-*/
sudo ./install.sh
```

Each of these installs a `texiom` command onto your `PATH`, usable from
any directory.

**Running from a git checkout without installing:**

```bash
git clone https://github.com/MrzAhmadi/Texiom.git
cd Texiom
./texiom
```

## Usage

```bash
texiom
```

It will interactively ask for the path to your `.tex` file (tab-completion
works, so you can navigate straight to it):

```
Path to the .tex file (or its directory): /path/to/your/project/paper.tex
```

Or run it non-interactively:

```bash
texiom --dir /path/to/your/project --file paper.tex
```

The resulting `paper.pdf` (and all `latexmk` auxiliary files) will appear
next to `paper.tex` in the original directory. Pass `--pdf-only` if you
just want the `.pdf` and none of the auxiliary files.

Documents that need `fontspec` (custom OpenType/TrueType fonts) must be built
with XeTeX or LuaTeX: pass `--engine xelatex` or `--engine lualatex`.

To rebuild automatically every time you save the file, pass `--watch`:

```bash
texiom --dir /path/to/your/project --file paper.tex --watch
```

This keeps running in the foreground and recompiles on every change to
`paper.tex` (or anything it includes) until you press Ctrl+C.

Only run one `--watch` per file at a time - two instances writing to the
same `.aux`/`.log` files at once will race each other and can produce
spurious `latexmk` errors.

### Rebuilding as you type, before you save

Write in VS Code (or any editor) and let `--watch` rebuild. `--watch` only sees
changes once they're written to disk, and an editor's unsaved buffer lives in memory only - so with a
manual save, the rebuild is one keystroke-to-save behind you. To have it
kick in automatically, enable Auto Save in VS Code so it writes the file
for you shortly after you stop typing:

1. Open VS Code's Settings (`Ctrl+,`).
2. Search for `files.autoSave` and set it to `afterDelay`.
3. Search for `files.autoSaveDelay` and set it to a short delay, e.g. `1000`
   (milliseconds).

Or add both directly to `settings.json`:

```json
"files.autoSave": "afterDelay",
"files.autoSaveDelay": 1000
```

With this on, VS Code saves the file on its own a second after you stop
typing, and a running `--watch` picks up that save and rebuilds - no manual
Ctrl+S needed.

### Commands

| Command                | What it does                                                       |
|------------------------|--------------------------------------------------------------------|
| `texiom`               | Compile a `.tex` file (prompts, or use `--dir` / `--file`)         |
| `texiom packs`         | List optional packs; installed ones are marked `[x]` (instant)     |
| `texiom add [PACK...]` | Install packs; without names, choose from a numbered list          |
| `texiom remove [PACK...]` | Uninstall packs                                                 |

### Options

| Flag              | Description                                                |
|-------------------|-------------------------------------------------------------|
| `-d, --dir DIR`   | Directory containing the `.tex` file                        |
| `-f, --file FILE` | Name of the `.tex` file (`.tex` extension optional)         |
| `-t, --tag TAG`   | Docker image tag to use/build (default: `texiom`)         |
| `-r, --rebuild`   | Force a fresh image build even if one already exists        |
| `--no-pull`       | Never download the prebuilt image from GHCR; always build locally |
| `--shell-escape`  | Allow LaTeX to run external programs (needed by `minted`) |
| `--apt PKGS`      | Install extra apt packages (comma-separated, repeatable) |
| `--pip PKGS`      | Install extra pip packages (comma-separated, repeatable) |
| `-E, --engine ENGINE` | LaTeX engine: `pdflatex` (default), `xelatex` or `lualatex` |
| `-p, --pdf-only`  | Remove `latexmk`'s auxiliary files after a successful build, leaving only the `.pdf` |
| `-w, --watch`     | Rebuild automatically whenever the `.tex` file changes, until Ctrl+C |
| `-v, --version`   | Show the installed version                                  |
| `-h, --help`      | Show usage                                                   |

The first run downloads the small base image (roughly 330 MB) from GitHub
Container Registry (`ghcr.io/mrzahmadi/texiom:slim`) and shows the download
progress. If it is unavailable, or doesn't match your installed version,
`texiom` builds the image locally instead (a few minutes) - pass `--no-pull`
to always build locally. Every run after that reuses the cached image.
Upgrading `texiom` to a new version automatically fetches the new base image
once if that version needs a different one, and reinstalls your packs on top
of it - no manual `--rebuild` required.

### Packs: extra LaTeX packages and tools

The base image covers most documents. Anything beyond it - science and math
packages, publisher templates, extra fonts, other languages, tools like
`latexdiff` - is a *pack*. `texiom packs` lists them all instantly, with the ones you
have installed marked `[x]`:

```
$ texiom packs
Packages
  [x] science          Science and math (siunitx, mhchem, algorithm2e)
  [ ] publishers       Publisher classes (IEEEtran, acmart, elsarticle)
  ...
Languages
  [ ] lang-arabic      Arabic and Persian (xepersian, bidi)
  ...
```

Install what you need - once, for every project from then on:

```bash
texiom add science lang-arabic     # installs both
texiom add                         # no names: pick from a numbered list
texiom remove science
```

Packs are stored in your Texiom image, and your selection in
`~/.config/texiom/packs`. Adding a pack downloads only that pack. Removing one
reinstalls the remaining packs on the base image. `texiom add full` installs
every TeX Live collection (without the documentation).

Writing a résumé? The `moderncv` and `europecv` classes are already in the base
image. Icon fonts such as `fontawesome5` come with the `fonts-extra` pack.
Templates that are not part of TeX Live (for example `awesome-cv` or `altacv`)
are not in any pack: put their `.cls` file next to your `.tex`.

### When a package is missing

If a build fails because a LaTeX package or tool is not installed, Texiom says so
instead of leaving you with a raw log:

```
The build failed because something is not installed:
  - LaTeX package 'algorithm2e.sty' is not installed. It is provided by the pack 'science'.
Install with: texiom add science
Install 'science' now and build again? [Y/n]
```

Answering yes installs the pack and re-runs the same command. The same applies to
`minted` (needs the `minted` pack), `\includesvg` (`inkscape`) and plots through
`gnuplot`. A missing file that is not a known package - your own style file, an
image - is reported as such rather than blamed on a pack.

### Project config (`texiom.toml`)

Put a `texiom.toml` next to your `.tex` file to save its settings, so a plain
`texiom -d .` is enough:

```toml
file = "main.tex"     # main file (skips the prompt)
engine = "xelatex"    # pdflatex (default), xelatex or lualatex
pdf_only = true       # remove auxiliary files after a successful build
watch = false         # rebuild on every change
shell_escape = false  # allow external programs (needed by minted)
apt = ["inkscape", "poppler-utils"]   # extra system packages
pip = ["pygments"]                    # extra Python packages
```

All keys are optional. Command-line flags override the file, except `apt` and
`pip`, which are combined.

### Extra system and Python packages (per project)

Need something that is not a pack - an arbitrary Ubuntu or PyPI package for one
project? List it under `apt` / `pip` in `texiom.toml`, or pass `--apt` / `--pip`
(comma-separated, repeatable):

```bash
texiom -d . --apt inkscape,ghostscript --pip pygments
```

Texiom adds a small layer on top of the base image and caches it, so the
install runs once per package set (and again only when the base image changes).
Python packages (`--pip`) install `python3-pip` into that layer on demand; it is
not part of the base image.
For `minted`, install the `minted` pack (`texiom add minted`) and enable
`shell_escape = true` (or pass `--shell-escape`).

## Upgrading from 0.0.64 or earlier

The browser editor (`texiom --edit`) was removed; Texiom is now a build tool and
`--watch` pairs it with the editor you already use. Projects you kept in the
editor live in the Docker volume `texiom-workspace`, which Texiom no longer
touches. Copy them out before you ever remove that volume:

```bash
mkdir -p texiom-projects
docker run --rm -u "$(id -u):$(id -g)" -v texiom-workspace:/from:ro \
  -v "$PWD/texiom-projects":/to ubuntu:24.04 cp -r /from/. /to/
```


The default image used to contain all of TeX Live. It is now a small base image
plus packs, so a document that used a package outside the base fails with a
message naming the pack to install (see above). To get the old behavior in one
step: `texiom add full`.

## Using as a VS Code Dev Container

The Dev Container builds the `full` image (every TeX Live collection). Open this folder (or any project that references this `.devcontainer/`) in
VS Code with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
and choose "Reopen in Container" for an interactive environment with the
LaTeX Workshop extension pre-configured to build on save.

## Using Texiom as a GitHub Action

The same images are published to GHCR and available as a reusable GitHub
Action, so any repo with a `.tex` file can build a PDF on every push
without installing anything. By default it runs the `full` image (every TeX
Live collection); for a much smaller pull, use the `slim` image and add what
you need with `apt`:

```yaml
- uses: actions/checkout@v4
- uses: MrzAhmadi/Texiom@main
  with:
    root_file: paper.tex
```

Faster, smaller (slim base plus the Ubuntu packages you need):

```yaml
- uses: MrzAhmadi/Texiom@main
  with:
    root_file: paper.tex
    image: ghcr.io/mrzahmadi/texiom:slim
    apt: texlive-science
```

Pin to a released tag (e.g. `@v0.0.3`) instead of `@main` for reproducible
builds once one exists.

### Inputs

| Input               | Description                                                              | Default                          |
|---------------------|--------------------------------------------------------------------------|----------------------------------|
| `root_file`         | Main `.tex` file, relative to `working_directory` (or `file` in `texiom.toml`) | *(from `texiom.toml`)*      |
| `working_directory` | Directory containing the `.tex` sources and an optional `texiom.toml`    | `.`                              |
| `engine`            | `pdflatex`, `xelatex` or `lualatex`                                      | `pdflatex` (or `texiom.toml`)    |
| `shell_escape`      | Pass `-shell-escape` to `latexmk` (needed by `minted`)                   | `false`                          |
| `apt`               | Extra apt packages to install before building (comma or space separated) | *(none)*                         |
| `pip`               | Extra pip packages to install before building                            | *(none)*                         |
| `args`              | Extra arguments appended to the `latexmk` command                        | *(none)*                         |
| `upload_artifact`   | Upload the PDF as a workflow artifact                                    | `false`                          |
| `artifact_name`     | Name of the uploaded artifact                                            | `pdf`                            |
| `image`             | Texiom image to run: `:latest` / `:full` (everything) or `:slim`; pin a version tag for reproducible builds | `ghcr.io/mrzahmadi/texiom:latest` |

Inputs take precedence over `texiom.toml` (`apt` and `pip` lists are
combined), so a repo that already has a `texiom.toml` needs no inputs at all
beyond `uses:`.

**Output:** `pdf_path` - the compiled PDF, relative to the workspace root.

```yaml
- uses: actions/checkout@v4
- uses: MrzAhmadi/Texiom@main
  id: texiom
  with:
    root_file: paper.tex
    engine: xelatex
    upload_artifact: true
- run: echo "Built ${{ steps.texiom.outputs.pdf_path }}"
```

> **Upgrading:** `args` used to replace the default `latexmk` arguments; it now
> only appends extra ones (use `engine` instead of passing `-xelatex`).

The compiled PDF is also left next to the source file for a later step (e.g.
attaching it to a release) to pick up.

### Attaching the PDF to a GitHub Release on tag

```yaml
name: Release PDF

on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: MrzAhmadi/Texiom@main
        id: texiom
        with:
          root_file: paper.tex

      - uses: softprops/action-gh-release@v2
        with:
          files: ${{ steps.texiom.outputs.pdf_path }}
```

## Keywords

LaTeX, Docker, TeX Live, pdflatex, xelatex, lualatex, latexmk, biber, online
LaTeX compiler, offline LaTeX build tool, Overleaf alternative for local builds, PDF compiler, GitHub
Action, Dev Container.

## License

MIT

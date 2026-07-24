#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/latexbuild" ] || [ ! -f "$DIR/.devcontainer/Dockerfile" ]; then
  echo "ERROR: run this script from inside the extracted latexbuild-*-linux.tar.gz directory." >&2
  exit 1
fi

echo "Installing latexbuild to /opt/latexbuild ..."
mkdir -p /opt/latexbuild/.devcontainer
cp "$DIR/latexbuild" /opt/latexbuild/latexbuild
cp "$DIR/.devcontainer/Dockerfile" /opt/latexbuild/.devcontainer/Dockerfile
cp "$DIR/VERSION" /opt/latexbuild/VERSION
chmod +x /opt/latexbuild/latexbuild
ln -sf /opt/latexbuild/latexbuild /usr/local/bin/latexbuild

echo "Done. Run: latexbuild --help"

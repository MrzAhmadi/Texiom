#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/texbuild" ] || [ ! -f "$DIR/.devcontainer/Dockerfile" ]; then
  echo "ERROR: run this script from inside the extracted texbuild-*-linux.tar.gz directory." >&2
  exit 1
fi

echo "Installing texbuild to /opt/texbuild ..."
mkdir -p /opt/texbuild/.devcontainer
cp "$DIR/texbuild" /opt/texbuild/texbuild
cp "$DIR/.devcontainer/Dockerfile" /opt/texbuild/.devcontainer/Dockerfile
cp "$DIR/VERSION" /opt/texbuild/VERSION
chmod +x /opt/texbuild/texbuild
ln -sf /opt/texbuild/texbuild /usr/local/bin/texbuild

echo "Done. Run: texbuild --help"

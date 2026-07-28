#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/texiom" ] || [ ! -f "$DIR/docker/Dockerfile" ]; then
  echo "ERROR: run this script from inside the extracted texiom-*-linux.tar.gz directory." >&2
  exit 1
fi

echo "Installing texiom to /opt/texiom ..."
mkdir -p /opt/texiom
cp "$DIR/texiom" /opt/texiom/texiom
cp -r "$DIR/docker" /opt/texiom/docker
cp "$DIR/VERSION" /opt/texiom/VERSION
chmod +x /opt/texiom/texiom
ln -sf /opt/texiom/texiom /usr/local/bin/texiom

if [ -f "$DIR/completions/texiom.bash" ] && [ -d /usr/share/bash-completion/completions ]; then
  cp "$DIR/completions/texiom.bash" /usr/share/bash-completion/completions/texiom
fi

echo "Done. Run: texiom --help"

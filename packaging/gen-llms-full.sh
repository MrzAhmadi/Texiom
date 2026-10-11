#!/usr/bin/env bash
# Regenerates docs/llms-full.txt (README + CLI help in one file) and syncs the version in docs/llms.txt. Run after changing README or options.
set -euo pipefail
cd "$(dirname "$0")/.."
sed -i "s/^Current version: .*\./Current version: $(cat VERSION)./" docs/llms.txt
{
    echo "# Texiom - full documentation"
    echo
    echo "> Generated from README.md and \`texiom --help\` (version $(cat VERSION)). See llms.txt for the short index."
    echo
    grep -v '^!\[\|^\[!\[\|^<p align\|^  <img\|^</p>' README.md
    echo
    echo "## CLI help (texiom --help)"
    echo
    echo '```'
    ./texiom --help
    echo '```'
} > docs/llms-full.txt
echo "Wrote docs/llms-full.txt"

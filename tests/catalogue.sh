#!/usr/bin/env bash
# Consistency of the shipped data: packs.conf, base.packages, pack-index.tsv, Dockerfile stages.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$ROOT/docker/packs.conf"; INDEX="$ROOT/lib/pack-index.tsv"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }
expect() { local desc="$1"; shift; if "$@" >/dev/null 2>&1; then ok; else fail "$desc"; fi; }

rows() { awk -F'\t' '!/^#/ && NF > 0' "$CONF"; }

expect "every pack row has exactly 4 tab-separated fields" test -z "$(awk -F'\t' '!/^#/ && NF > 0 && NF != 4' "$CONF")"
expect "pack names are unique" test -z "$(rows | cut -f1 | sort | uniq -d)"
expect "pack names are lowercase words" test -z "$(rows | cut -f1 | grep -vE '^[a-z0-9][a-z0-9-]*$')"
groups="Packages Fonts Tools Languages Everything"
for g in $(rows | cut -f2 | sort -u); do
    expect "group '$g' is a known group" grep -qw "$g" <<<"$groups"
done
expect "apt package names are well formed" test -z "$(rows | cut -f4 | tr ' ' '\n' | grep -vE '^[A-Za-z0-9][A-Za-z0-9._+:=~-]*$')"
expect "descriptions are short enough for one line" test -z "$(rows | awk -F'\t' 'length($3) > 52 {print $1}')"
expect "there is exactly one 'full' pack" test "$(rows | cut -f1 | grep -cx full)" -eq 1

# `full` must cover every TeX Live collection offered as its own pack.
full="$(rows | awk -F'\t' '$1 == "full" {print $4}' | tr ' ' '\n' | sort -u)"
missing="$(rows | awk -F'\t' '$1 != "full" {print $4}' | tr ' ' '\n' | grep '^texlive-' | sort -u | comm -23 - <(echo "$full"))"
expect "'full' includes all texlive-* packages of the other packs (missing: ${missing:-none})" test -z "$missing"

expect "base.packages lists packages" test "$(grep -vc '^#' "$ROOT/docker/base.packages")" -gt 5
expect "base.packages has no duplicates" test -z "$(grep -v '^#' "$ROOT/docker/base.packages" | sort | uniq -d)"

expect "pack index rows are 'file<TAB>pack'" test -z "$(awk -F'\t' 'NF != 2' "$INDEX")"
expect "pack index only names real packs" test -z "$(cut -f2 "$INDEX" | sort -u | comm -23 - <(rows | cut -f1 | sort -u))"
expect "pack index only holds package files" test -z "$(cut -f1 "$INDEX" | grep -vE '\.(sty|cls|clo|bst|bbx|cbx|lbx|def|fd|ldf|cfg)$')"
expect "pack index is sorted and unique" test "$(cut -f1 "$INDEX" | LC_ALL=C sort -c 2>&1 | wc -l)" -eq 0

expect "Dockerfile defines the slim and full stages" bash -c "grep -q 'AS slim' '$ROOT/docker/Dockerfile' && grep -q 'AS full' '$ROOT/docker/Dockerfile'"
expect "the full stage is last (default build target)" test "$(grep '^FROM' "$ROOT/docker/Dockerfile" | tail -1 | awk '{print $NF}')" = full

echo "catalogue tests: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]

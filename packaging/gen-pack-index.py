#!/usr/bin/env python3
"""Generate lib/pack-index.tsv: which Texiom pack provides a given LaTeX package file.

texiom uses the index after a failed build ("File `algorithm2e.sty' not found") to name the pack to
install. It is derived from Ubuntu's own package data, so re-run it when docker/packs.conf or
docker/base.packages change, or when the Ubuntu release in docker/Dockerfile changes:

    python3 packaging/gen-pack-index.py                 # downloads ~75 MB of Ubuntu indexes
    python3 packaging/gen-pack-index.py --data DIR      # reuse previously downloaded files

Standard library only.
"""
import argparse
import gzip
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RELEASE = "noble"
MIRROR = "https://archive.ubuntu.com/ubuntu/dists"
INDEXES = {
    "main.gz": f"{RELEASE}/main/binary-amd64/Packages.gz",
    "universe.gz": f"{RELEASE}/universe/binary-amd64/Packages.gz",
    "main-up.gz": f"{RELEASE}-updates/main/binary-amd64/Packages.gz",
    "universe-up.gz": f"{RELEASE}-updates/universe/binary-amd64/Packages.gz",
    "contents.gz": f"{RELEASE}/Contents-amd64.gz",
}
# File types TeX loads as packages; matches PACKAGE_FILE_PATTERN in lib/diagnose.sh.
EXTENSIONS = (".sty", ".cls", ".clo", ".bst", ".bbx", ".cbx", ".lbx", ".def", ".fd", ".ldf", ".cfg")
TEXMF_PREFIXES = ("usr/share/texlive/", "usr/share/texmf/")


def fetch(data_dir):
    for name, path in INDEXES.items():
        target = data_dir / name
        if not target.exists():
            print(f"downloading {path}", file=sys.stderr)
            urllib.request.urlretrieve(f"{MIRROR}/{path}", target)


def parse_packages(path):
    packages, current = {}, {}
    with gzip.open(path, "rt", errors="replace") as handle:
        for line in handle:
            if not line.strip():
                if "Package" in current:
                    packages[current["Package"]] = current
                current = {}
            elif line[0] not in " \t":
                key, _, value = line.partition(":")
                current[key] = value.strip()
    if "Package" in current:
        packages[current["Package"]] = current
    return packages


def read_list(path):
    lines = (line.split("#")[0].strip() for line in path.read_text().splitlines())
    return [line for line in lines if line]


def read_packs(path):
    packs = {}
    for line in path.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        name, _group, _desc, apt = line.split("\t")
        packs[name] = apt.split()
    return packs


class Resolver:
    """Dependency closure over the Ubuntu index (first alternative wins; good enough for sizing/ownership)."""

    def __init__(self, packages):
        self.packages = packages
        self.provides = {}
        for name, data in packages.items():
            for provided in data.get("Provides", "").split(","):
                provided = provided.strip().split(" ")[0]
                if provided:
                    self.provides.setdefault(provided, []).append(name)
        self.base = {n for n, d in packages.items() if d.get("Essential") == "yes" or d.get("Priority") == "required"}

    def resolve(self, alternatives):
        for alt in alternatives:
            if alt in self.packages:
                return alt
        for alt in alternatives:
            if alt in self.provides:
                return self.provides[alt][0]
        return None

    def closure(self, roots):
        seen, stack = set(), list(roots)
        while stack:
            name = stack.pop()
            if name in seen or name in self.base or name not in self.packages:
                continue
            seen.add(name)
            for field in ("Depends", "Pre-Depends"):
                for group in self.packages[name].get(field, "").split(","):
                    alts = [a.strip().split(" ")[0].split(":")[0] for a in group.split("|") if a.strip()]
                    resolved = self.resolve(alts) if alts else None
                    if resolved:
                        stack.append(resolved)
        return seen


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, help="directory with the Ubuntu index files (downloaded if missing)")
    parser.add_argument("--out", type=Path, default=ROOT / "lib" / "pack-index.tsv")
    args = parser.parse_args()

    data_dir = args.data or Path(tempfile.mkdtemp(prefix="texiom-index-"))
    data_dir.mkdir(parents=True, exist_ok=True)
    fetch(data_dir)

    packages = {}
    for name in ("main.gz", "universe.gz", "main-up.gz", "universe-up.gz"):
        packages.update(parse_packages(data_dir / name))

    packs = read_packs(ROOT / "docker" / "packs.conf")
    resolver = Resolver(packages)
    missing = sorted({p for apt in packs.values() for p in apt if p not in packages})
    if missing:
        sys.exit(f"packs.conf names packages Ubuntu {RELEASE} does not have: {', '.join(missing)}")
    base_roots = read_list(ROOT / "docker" / "base.packages")
    base_closure = resolver.closure(base_roots)

    # Owner pack per Ubuntu package: the smallest pack that lists it ("full" only as a last resort).
    def pack_size(name):
        return sum(int(packages[p]["Size"]) for p in packs[name])

    owners = {}
    for name in sorted(packs, key=lambda n: (n == "full", pack_size(n))):
        for apt in packs[name]:
            owners.setdefault(apt, name)
    # Dependencies of a pack belong to the pack that lists them, else (if non-slim) nowhere.

    entries = {}
    with gzip.open(data_dir / "contents.gz", "rt", errors="replace") as handle:
        for line in handle:
            parts = re.split(r"\s+", line.strip(), maxsplit=1)
            if len(parts) != 2:
                continue
            path, providers = parts
            if not path.endswith(EXTENSIONS) or not path.startswith(TEXMF_PREFIXES):
                continue
            file_name = path.rsplit("/", 1)[-1]
            names = [p.split("/")[-1] for p in providers.split(",")]
            if any(n in base_closure for n in names):
                entries.pop(file_name, None)
                entries[file_name] = None            # provided by the slim base: never missing
                continue
            if entries.get(file_name, "unset") is None:
                continue
            candidates = [owners[n] for n in names if n in owners]
            if candidates:
                best = min(candidates, key=lambda n: (n == "full", pack_size(n)))
                if file_name not in entries or pack_size(best) < pack_size(entries[file_name]):
                    entries[file_name] = best

    rows = sorted((f, p) for f, p in entries.items() if p)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("".join(f"{f}\t{p}\n" for f, p in rows))
    print(f"wrote {len(rows)} entries to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()

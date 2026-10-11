import re
from pathlib import Path

from .workspace import WORKSPACE_ROOT

NAVIGABLE_SUFFIXES = (".tex", ".bib")

FILE_LINE_ERROR = re.compile(r"^(\S[^:\n]*\.[A-Za-z0-9]+):(\d+): (.*)$")
BANG_ERROR = re.compile(r"^! (.*)$")
CONTEXT_LINE = re.compile(r"^l\.(\d+) ?(.*)$")
WARNING_START = re.compile(r"^(?:LaTeX|Package \S+|Class \S+|Module \S+) Warning: (.*)$")
INPUT_LINE = re.compile(r"on input line (\d+)")
PACKAGE_PREFIX = re.compile(r"^\((?:[^)]*)\)\s*")


def workspace_relative(name, base_dir):
    """Map a file name from a TeX log to a workspace-relative path we can open, else None."""
    try:
        full = (base_dir / name).resolve()
        relative = full.relative_to(WORKSPACE_ROOT)
    except (ValueError, OSError):
        return None
    if relative.suffix not in NAVIGABLE_SUFFIXES or not full.is_file():
        return None
    return str(relative)


def read_context(lines, start):
    """Find the 'l.N source' line following an error; returns (line, text) or (None, '')."""
    for j in range(start, min(start + 12, len(lines))):
        match = CONTEXT_LINE.match(lines[j])
        if match:
            text = match.group(2).strip()
            if j + 1 < len(lines) and lines[j + 1].strip() and not CONTEXT_LINE.match(lines[j + 1]):
                text = (text + " " + lines[j + 1].strip()).strip()
            return int(match.group(1)), text
    return None, ""


def parse_log(log_text, base_dir, main_file):
    """Extract errors (and warnings that carry a line number) from a TeX .log."""
    lines = log_text.splitlines()
    found = []
    seen = set()
    i = 0
    while i < len(lines):
        line = lines[i]
        match = FILE_LINE_ERROR.match(line)
        if match:
            name, number, message = match.group(1), int(match.group(2)), match.group(3).strip()
            _, context = read_context(lines, i + 1)
            found.append({
                "severity": "error",
                "file": workspace_relative(name, base_dir),
                "source": name[2:] if name.startswith("./") else name,
                "line": number,
                "message": message,
                "context": context,
            })
        else:
            bang = BANG_ERROR.match(line)
            if bang:
                number, context = read_context(lines, i + 1)
                found.append({
                    "severity": "error",
                    "file": main_file,
                    "source": main_file,
                    "line": number,
                    "message": bang.group(1).strip(),
                    "context": context,
                })
            else:
                start = WARNING_START.match(line)
                if start:
                    parts = [start.group(1).strip()]
                    j = i + 1
                    while j < len(lines) and lines[j].strip():
                        parts.append(PACKAGE_PREFIX.sub("", lines[j]).strip())
                        j += 1
                    message = " ".join(parts)
                    at = INPUT_LINE.search(message)
                    if at:
                        found.append({
                            "severity": "warning",
                            "file": main_file,
                            "source": main_file,
                            "line": int(at.group(1)),
                            "message": INPUT_LINE.sub("", message).strip(" ."),
                            "context": "",
                        })
                    i = j
                    continue
        i += 1

    unique = []
    for item in found:
        if item["message"].startswith("==> Fatal error"):
            continue  # summary line TeX prints after the real error
        key = (item["severity"], item["file"], item["line"], item["message"])
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique

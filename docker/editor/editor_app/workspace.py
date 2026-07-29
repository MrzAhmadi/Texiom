import json
import os
import shutil
from pathlib import Path

EDITOR_DIR = Path(__file__).parent.parent
STATIC_DIR = EDITOR_DIR / "static"
TEMPLATES_DIR = EDITOR_DIR / "templates"

WORKSPACE_ROOT = Path.cwd().resolve()


def is_hidden(relative_path):
    return any(part.startswith(".") for part in relative_path.parts)


def resolve_in_workspace(relative_str):
    relative = Path(relative_str)
    if is_hidden(relative) or relative == Path(".") or str(relative).startswith(".."):
        return None
    full_path = (WORKSPACE_ROOT / relative).resolve()
    if os.path.commonpath([str(WORKSPACE_ROOT), str(full_path)]) != str(WORKSPACE_ROOT):
        return None
    return relative, full_path


class WorkspaceState:
    def __init__(self):
        self.tex_file = None
        self.pdf_file = None
        self.editing_file = None
        self.open_tabs = []
        self.state_file = WORKSPACE_ROOT / ".texiom-state.json"
        self._load()

    def full_tex_path(self):
        return WORKSPACE_ROOT / self.tex_file

    def full_pdf_path(self):
        return WORKSPACE_ROOT / self.pdf_file

    def full_editing_path(self):
        return WORKSPACE_ROOT / self.editing_file

    def save(self):
        try:
            self.state_file.write_text(json.dumps({
                "tex_file": str(self.tex_file) if self.tex_file else None,
                "editing_file": str(self.editing_file) if self.editing_file else None,
                "open_tabs": self.open_tabs,
            }))
        except OSError:
            pass

    def _load(self):
        try:
            data = json.loads(self.state_file.read_text())
        except (OSError, ValueError):
            return
        tex_file = data.get("tex_file")
        editing_file = data.get("editing_file")
        if tex_file and (WORKSPACE_ROOT / tex_file).is_file():
            self.tex_file = Path(tex_file)
            self.pdf_file = self.tex_file.with_suffix(".pdf")
        if editing_file and (WORKSPACE_ROOT / editing_file).is_file():
            self.editing_file = Path(editing_file)
        elif self.tex_file:
            self.editing_file = self.tex_file
        self.open_tabs = [p for p in data.get("open_tabs", []) if (WORKSPACE_ROOT / p).is_file()]

    def select(self, relative):
        self.editing_file = relative
        if relative.suffix == ".tex":
            self.tex_file = relative
            self.pdf_file = relative.with_suffix(".pdf")
        self.save()

    def deselect(self):
        self.tex_file = None
        self.pdf_file = None
        self.editing_file = None
        self.save()

    def set_open_tabs(self, tabs):
        self.open_tabs = tabs
        self.save()

    def remap_after_rename(self, from_rel, to_rel):
        def remap(current):
            if current is None:
                return None
            if current == from_rel:
                return to_rel
            try:
                suffix = current.relative_to(from_rel)
            except ValueError:
                return current
            return to_rel / suffix

        self.tex_file = remap(self.tex_file)
        self.pdf_file = self.tex_file.with_suffix(".pdf") if self.tex_file else None
        self.editing_file = remap(self.editing_file)
        self.open_tabs = [str(remap(Path(p))) for p in self.open_tabs]
        self.save()

    def clear_after_delete(self, relative):
        def affects(current):
            return current is not None and (current == relative or relative in current.parents)

        closed_current = affects(self.editing_file)
        if affects(self.tex_file):
            self.tex_file = None
            self.pdf_file = None
        if closed_current:
            self.editing_file = None
        self.open_tabs = [p for p in self.open_tabs if not affects(Path(p))]
        self.save()
        return closed_current


def seed_workspace_if_empty():
    seed_marker = WORKSPACE_ROOT / ".texiom-seeded"
    if seed_marker.exists():
        return
    has_content = any(not p.name.startswith(".") for p in WORKSPACE_ROOT.iterdir())
    if not has_content:
        sample_src = TEMPLATES_DIR / "sample"
        if sample_src.is_dir():
            shutil.copytree(sample_src, WORKSPACE_ROOT / "sample")
    seed_marker.touch()


seed_workspace_if_empty()
workspace = WorkspaceState()

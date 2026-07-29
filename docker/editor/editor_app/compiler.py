import asyncio
import os
from pathlib import Path

from .workspace import WORKSPACE_ROOT, workspace

AUX_EXTENSIONS = [
    "aux", "log", "out", "toc", "lof", "lot", "fls", "fdb_latexmk",
    "bbl", "blg", "bcf", "run.xml", "nav", "snm", "vrb",
]

HIDDEN_TREE_SUFFIXES = AUX_EXTENSIONS + [
    "synctex.gz", "auxlock", "xmpi", "bcf-SAVE-ERROR", "bbl-SAVE-ERROR",
]

WORKER_COUNT = min(4, os.cpu_count() or 1)

compile_queue = asyncio.Queue()
queued_files = set()
dirty_during_compile = set()
compile_results = {}
compiling_now = set()


def is_build_artifact(path):
    return any(path.name.endswith("." + suffix) for suffix in HIDDEN_TREE_SUFFIXES)


def remove_aux_files():
    base = str(workspace.full_tex_path().with_suffix(""))
    for ext in AUX_EXTENSIONS:
        Path(f"{base}.{ext}").unlink(missing_ok=True)


async def compile_worker():
    while True:
        file_str = await compile_queue.get()
        compiling_now.add(file_str)
        dirty_during_compile.discard(file_str)
        rel = Path(file_str)
        full = WORKSPACE_ROOT / rel
        process = await asyncio.create_subprocess_exec(
            "latexmk", "-pdf", "-synctex=1", "-interaction=nonstopmode", "-halt-on-error", rel.name,
            cwd=str(full.parent),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        ok = process.returncode == 0 and full.with_suffix(".pdf").exists()
        if ok:
            base = str(full.with_suffix(""))
            for ext in AUX_EXTENSIONS:
                Path(f"{base}.{ext}").unlink(missing_ok=True)
        log = (stdout.decode(errors="replace") + stderr.decode(errors="replace"))[-4000:]
        compile_results[file_str] = {"ok": ok, "log": log}
        compiling_now.discard(file_str)
        if file_str in dirty_during_compile:
            await compile_queue.put(file_str)
        else:
            queued_files.discard(file_str)
        compile_queue.task_done()

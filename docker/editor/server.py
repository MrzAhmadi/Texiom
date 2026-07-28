#!/usr/bin/env python3
import asyncio
import io
import json
import os
import re
import shutil
import subprocess
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"

WORKSPACE_ROOT = Path.cwd().resolve()
STATE_FILE = WORKSPACE_ROOT / ".latexbuild-state.json"

TEX_FILE = None
PDF_FILE = None
EDITING_FILE = None
OPEN_TABS = []

AUX_EXTENSIONS = [
    "aux", "log", "out", "toc", "lof", "lot", "fls", "fdb_latexmk",
    "bbl", "blg", "bcf", "run.xml", "nav", "snm", "vrb",
]

HIDDEN_TREE_SUFFIXES = AUX_EXTENSIONS + [
    "synctex.gz", "auxlock", "xmpi", "bcf-SAVE-ERROR", "bbl-SAVE-ERROR",
]


def is_build_artifact(path):
    return any(path.name.endswith("." + suffix) for suffix in HIDDEN_TREE_SUFFIXES)


def full_tex_path():
    return WORKSPACE_ROOT / TEX_FILE


def full_pdf_path():
    return WORKSPACE_ROOT / PDF_FILE


def full_editing_path():
    return WORKSPACE_ROOT / EDITING_FILE


def save_state():
    try:
        STATE_FILE.write_text(json.dumps({
            "tex_file": str(TEX_FILE) if TEX_FILE else None,
            "editing_file": str(EDITING_FILE) if EDITING_FILE else None,
            "open_tabs": OPEN_TABS,
        }))
    except OSError:
        pass


def load_state():
    global TEX_FILE, PDF_FILE, EDITING_FILE, OPEN_TABS
    try:
        data = json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return
    tex_file = data.get("tex_file")
    editing_file = data.get("editing_file")
    if tex_file and (WORKSPACE_ROOT / tex_file).is_file():
        TEX_FILE = Path(tex_file)
        PDF_FILE = TEX_FILE.with_suffix(".pdf")
    if editing_file and (WORKSPACE_ROOT / editing_file).is_file():
        EDITING_FILE = Path(editing_file)
    elif TEX_FILE:
        EDITING_FILE = TEX_FILE
    OPEN_TABS = [p for p in data.get("open_tabs", []) if (WORKSPACE_ROOT / p).is_file()]


load_state()

WORKER_COUNT = min(4, os.cpu_count() or 1)

compile_queue = asyncio.Queue()
queued_files = set()
dirty_during_compile = set()
compile_results = {}
compiling_now = set()


def remove_aux_files():
    base = str(full_tex_path().with_suffix(""))
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


@asynccontextmanager
async def lifespan(app):
    for _ in range(WORKER_COUNT):
        asyncio.create_task(compile_worker())
    yield


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def disable_caching(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/source", response_class=PlainTextResponse)
def get_source():
    return full_editing_path().read_text() if EDITING_FILE else ""


@app.get("/current")
def get_current():
    return JSONResponse({
        "file": str(EDITING_FILE) if EDITING_FILE else None,
        "tex_file": str(TEX_FILE) if TEX_FILE else None,
        "open_tabs": OPEN_TABS,
    })


@app.post("/state/tabs")
async def set_open_tabs(request: Request):
    global OPEN_TABS
    body = await request.json()
    tabs = []
    for p in body.get("tabs", []):
        resolved = resolve_in_workspace(str(p))
        if resolved is not None and resolved[1].is_file():
            tabs.append(str(resolved[0]))
    OPEN_TABS = tabs
    save_state()
    return JSONResponse({"ok": True})


@app.post("/deselect")
async def deselect_file():
    global TEX_FILE, PDF_FILE, EDITING_FILE
    TEX_FILE = None
    PDF_FILE = None
    EDITING_FILE = None
    save_state()
    return JSONResponse({"ok": True})


def is_hidden(relative_path):
    return any(part.startswith(".") for part in relative_path.parts)


@app.get("/tree")
def get_tree():
    files = sorted(
        str(p.relative_to(WORKSPACE_ROOT))
        for p in WORKSPACE_ROOT.rglob("*")
        if p.is_file()
        and not is_hidden(p.relative_to(WORKSPACE_ROOT))
    )
    dirs = sorted(
        str(p.relative_to(WORKSPACE_ROOT))
        for p in WORKSPACE_ROOT.rglob("*")
        if p.is_dir()
        and not is_hidden(p.relative_to(WORKSPACE_ROOT))
    )
    return JSONResponse({
        "files": files,
        "dirs": dirs,
        "current": str(EDITING_FILE) if EDITING_FILE else None,
        "tex_file": str(TEX_FILE) if TEX_FILE else None,
    })


def resolve_in_workspace(relative_str):
    relative = Path(relative_str)
    if is_hidden(relative) or relative == Path(".") or str(relative).startswith(".."):
        return None
    full_path = (WORKSPACE_ROOT / relative).resolve()
    if os.path.commonpath([str(WORKSPACE_ROOT), str(full_path)]) != str(WORKSPACE_ROOT):
        return None
    return relative, full_path


@app.post("/fs/create-folder")
async def create_folder(request: Request):
    resolved = resolve_in_workspace((await request.body()).decode().strip())
    if resolved is None:
        return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
    _, full_path = resolved
    if full_path.exists():
        return JSONResponse({"ok": False, "error": "already exists"}, status_code=409)
    full_path.mkdir(parents=True)
    return JSONResponse({"ok": True})


@app.post("/fs/create-file")
async def create_file(request: Request):
    resolved = resolve_in_workspace((await request.body()).decode().strip())
    if resolved is None:
        return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
    _, full_path = resolved
    if full_path.exists():
        return JSONResponse({"ok": False, "error": "already exists"}, status_code=409)
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_text("")
    return JSONResponse({"ok": True})


@app.post("/fs/rename")
async def rename_path(request: Request):
    global TEX_FILE, PDF_FILE, EDITING_FILE, OPEN_TABS
    body = await request.json()
    from_resolved = resolve_in_workspace(str(body.get("from", "")))
    to_resolved = resolve_in_workspace(str(body.get("to", "")))
    if from_resolved is None or to_resolved is None:
        return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
    from_rel, from_full = from_resolved
    to_rel, to_full = to_resolved
    if not from_full.exists():
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    if to_full.exists():
        return JSONResponse({"ok": False, "error": "a file or folder with that name already exists"}, status_code=409)

    to_full.parent.mkdir(parents=True, exist_ok=True)
    from_full.rename(to_full)

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

    TEX_FILE = remap(TEX_FILE)
    PDF_FILE = TEX_FILE.with_suffix(".pdf") if TEX_FILE else None
    EDITING_FILE = remap(EDITING_FILE)
    OPEN_TABS = [str(remap(Path(p))) for p in OPEN_TABS]
    save_state()
    return JSONResponse({
        "ok": True,
        "editing_file": str(EDITING_FILE) if EDITING_FILE else None,
        "open_tabs": OPEN_TABS,
    })


@app.post("/fs/delete")
async def delete_path(request: Request):
    global TEX_FILE, PDF_FILE, EDITING_FILE, OPEN_TABS
    resolved = resolve_in_workspace((await request.body()).decode().strip())
    if resolved is None:
        return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
    relative, full_path = resolved
    if not full_path.exists():
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)

    def affects(current):
        return current is not None and (current == relative or relative in current.parents)

    closed_current = affects(EDITING_FILE)
    if affects(TEX_FILE):
        TEX_FILE = None
        PDF_FILE = None
    if closed_current:
        EDITING_FILE = None
    OPEN_TABS = [p for p in OPEN_TABS if not affects(Path(p))]

    if full_path.is_dir():
        shutil.rmtree(full_path)
    else:
        full_path.unlink()
        base = str(full_path.with_suffix(""))
        for ext in HIDDEN_TREE_SUFFIXES:
            Path(f"{base}.{ext}").unlink(missing_ok=True)

    save_state()
    return JSONResponse({"ok": True, "closed_current": closed_current, "open_tabs": OPEN_TABS})


@app.get("/fs/download")
def download_path(path: str = ""):
    path = path.strip()
    if path in ("", "."):
        full_path = WORKSPACE_ROOT
        display_name = "project"
    else:
        resolved = resolve_in_workspace(path)
        if resolved is None:
            return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
        _, full_path = resolved
        display_name = full_path.name

    if not full_path.exists():
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)

    if full_path.is_file():
        return FileResponse(full_path, filename=display_name)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(full_path.rglob("*")):
            if p.is_file() and not is_build_artifact(p) and not is_hidden(p.relative_to(WORKSPACE_ROOT)):
                zf.write(p, arcname=str(p.relative_to(full_path)))
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{display_name}.zip"'},
    )


@app.post("/upload")
async def upload_file(request: Request):
    resolved = resolve_in_workspace(request.query_params.get("name", ""))
    if resolved is None:
        return JSONResponse({"ok": False}, status_code=400)
    _, full_path = resolved
    content = await request.body()
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    return JSONResponse({"ok": True})


@app.post("/select")
async def select_file(request: Request):
    global TEX_FILE, PDF_FILE, EDITING_FILE
    resolved = resolve_in_workspace((await request.body()).decode().strip())
    if resolved is None:
        return JSONResponse({"ok": False}, status_code=400)
    relative, full_path = resolved
    if relative.suffix not in (".tex", ".bib") or not full_path.is_file():
        return JSONResponse({"ok": False}, status_code=400)

    EDITING_FILE = relative

    if relative.suffix != ".tex":
        save_state()
        return JSONResponse({"ok": True, "file": str(EDITING_FILE), "is_tex": False, "compile_state": "idle"})

    TEX_FILE = relative
    PDF_FILE = TEX_FILE.with_suffix(".pdf")
    save_state()
    file_str = str(TEX_FILE)
    if file_str in queued_files:
        state = "compiling" if file_str in compiling_now else "queued"
    else:
        remove_aux_files()
        state = "idle"
    return JSONResponse({"ok": True, "file": file_str, "is_tex": True, "compile_state": state})


@app.post("/save")
async def save_tex(request: Request):
    if EDITING_FILE is None:
        return JSONResponse({"ok": False}, status_code=400)
    content = (await request.body()).decode()
    path = full_editing_path()
    if not content.strip() and path.exists() and path.stat().st_size > 0:
        return JSONResponse(
            {"ok": False, "log": "Refusing to overwrite a non-empty file with empty content."},
            status_code=409,
        )
    path.write_text(content)
    return JSONResponse({"ok": True})


@app.post("/compile")
async def compile_tex():
    if TEX_FILE is None:
        return JSONResponse(
            {"ok": False, "log": "No .tex file selected yet - create or open one in the sidebar."},
            status_code=400,
        )
    file_str = str(TEX_FILE)
    if file_str in queued_files:
        dirty_during_compile.add(file_str)
    else:
        queued_files.add(file_str)
        compile_results.pop(file_str, None)
        await compile_queue.put(file_str)
    return JSONResponse({"ok": True})


@app.get("/compile-status")
def compile_status(file: str):
    if file in queued_files:
        state = "compiling" if file in compiling_now else "queued"
        return JSONResponse({"state": state})
    result = compile_results.get(file)
    if result is None:
        return JSONResponse({"state": "idle"})
    return JSONResponse({"state": "done", "ok": result["ok"], "log": result["log"]})


@app.get("/compile-queue")
def get_compile_queue():
    return JSONResponse({"compiling": sorted(compiling_now), "queued": sorted(queued_files)})


def run_synctex(args):
    result = subprocess.run(
        ["synctex", *args],
        capture_output=True, text=True, cwd=str(full_tex_path().parent),
    )
    data = {}
    for line in result.stdout.splitlines():
        match = re.match(r"^(\w+):(.*)$", line)
        if match:
            data[match.group(1)] = match.group(2)
    return data


@app.get("/synctex/forward")
def synctex_forward(line: int, column: int = 1):
    if TEX_FILE is None or not full_pdf_path().exists():
        return JSONResponse({"ok": False}, status_code=400)
    data = run_synctex(["view", "-i", f"{line}:{column}:{full_tex_path()}", "-o", str(full_pdf_path())])
    if "Page" not in data:
        return JSONResponse({"ok": False}, status_code=404)
    return JSONResponse({
        "ok": True,
        "page": int(data["Page"]),
        "x": float(data.get("x", 0)),
        "y": float(data.get("y", 0)),
    })


@app.get("/synctex/inverse")
def synctex_inverse(page: int, x: float, y: float):
    if TEX_FILE is None or not full_pdf_path().exists():
        return JSONResponse({"ok": False}, status_code=400)
    data = run_synctex(["edit", "-o", f"{page}:{x}:{y}:{full_pdf_path()}"])
    if "Line" not in data:
        return JSONResponse({"ok": False}, status_code=404)
    return JSONResponse({"ok": True, "line": int(data["Line"]), "column": int(data.get("Column", -1))})


@app.get("/pdf")
def get_pdf():
    if PDF_FILE is None or not full_pdf_path().exists():
        return JSONResponse({"error": "no pdf"}, status_code=404)
    return FileResponse(full_pdf_path(), media_type="application/pdf")


active_sockets = set()


@app.websocket("/ws")
async def session_socket(websocket: WebSocket):
    await websocket.accept()
    for old in list(active_sockets):
        active_sockets.discard(old)
        try:
            await old.send_json({"type": "expired"})
            await old.close()
        except Exception:
            pass
    active_sockets.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        active_sockets.discard(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

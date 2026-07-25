#!/usr/bin/env python3
import argparse
import asyncio
import os
import shutil
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"

parser = argparse.ArgumentParser()
parser.add_argument("--file", required=False, default=None)
args = parser.parse_args()

WORKSPACE_ROOT = Path.cwd().resolve()
UPLOAD_ROOT = Path("/tmp/latexbuild-uploads")
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
ACTIVE_ROOT = WORKSPACE_ROOT


def first_tex_file(root):
    candidates = sorted(root.rglob("*.tex"))
    return candidates[0].relative_to(root) if candidates else None


TEX_FILE = Path(args.file) if args.file else first_tex_file(ACTIVE_ROOT)
PDF_FILE = TEX_FILE.with_suffix(".pdf") if TEX_FILE else None

AUX_EXTENSIONS = [
    "aux", "log", "out", "toc", "lof", "lot", "fls", "fdb_latexmk",
    "synctex.gz", "bbl", "blg", "bcf", "run.xml", "nav", "snm", "vrb",
]

HIDDEN_TREE_SUFFIXES = AUX_EXTENSIONS + [
    "auxlock", "xmpi", "bcf-SAVE-ERROR", "bbl-SAVE-ERROR",
]


def is_build_artifact(path):
    return any(path.name.endswith("." + suffix) for suffix in HIDDEN_TREE_SUFFIXES)


def full_tex_path():
    return ACTIVE_ROOT / TEX_FILE


def full_pdf_path():
    return ACTIVE_ROOT / PDF_FILE


compile_queue = asyncio.Queue()
queued_files = set()
dirty_during_compile = set()
compile_results = {}
compile_pdf_only = {}
compiling_now = None


def remove_aux_files():
    base = str(full_tex_path().with_suffix(""))
    for ext in AUX_EXTENSIONS:
        Path(f"{base}.{ext}").unlink(missing_ok=True)


async def compile_worker():
    global compiling_now
    while True:
        file_str = await compile_queue.get()
        compiling_now = file_str
        dirty_during_compile.discard(file_str)
        rel = Path(file_str)
        full = ACTIVE_ROOT / rel
        process = await asyncio.create_subprocess_exec(
            "latexmk", "-pdf", "-interaction=nonstopmode", "-halt-on-error", rel.name,
            cwd=str(full.parent),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        ok = process.returncode == 0 and full.with_suffix(".pdf").exists()
        if ok and compile_pdf_only.get(file_str):
            base = str(full.with_suffix(""))
            for ext in AUX_EXTENSIONS:
                Path(f"{base}.{ext}").unlink(missing_ok=True)
        log = (stdout.decode(errors="replace") + stderr.decode(errors="replace"))[-4000:]
        compile_results[file_str] = {"ok": ok, "log": log}
        compiling_now = None
        if file_str in dirty_during_compile:
            await compile_queue.put(file_str)
        else:
            queued_files.discard(file_str)
        compile_queue.task_done()


app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
async def start_compile_worker():
    asyncio.create_task(compile_worker())


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
    return full_tex_path().read_text() if TEX_FILE else ""


@app.get("/current")
def get_current():
    return JSONResponse({"file": str(TEX_FILE) if TEX_FILE else None})


@app.get("/tree")
def get_tree():
    files = sorted(
        str(p.relative_to(ACTIVE_ROOT))
        for p in ACTIVE_ROOT.rglob("*")
        if p.is_file() and not is_build_artifact(p)
    )
    return JSONResponse({"files": files, "current": str(TEX_FILE) if TEX_FILE else None})


def resolve_in_active_root(relative_str):
    relative = Path(relative_str)
    if any(part.startswith(".") for part in relative.parts):
        return None
    full_path = (ACTIVE_ROOT / relative).resolve()
    if os.path.commonpath([str(ACTIVE_ROOT), str(full_path)]) != str(ACTIVE_ROOT):
        return None
    return relative, full_path


@app.post("/clear-workspace")
def clear_workspace():
    global TEX_FILE, PDF_FILE, ACTIVE_ROOT
    for entry in UPLOAD_ROOT.iterdir():
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    ACTIVE_ROOT = UPLOAD_ROOT
    TEX_FILE = None
    PDF_FILE = None
    queued_files.clear()
    dirty_during_compile.clear()
    compile_results.clear()
    compile_pdf_only.clear()
    return JSONResponse({"ok": True})


@app.post("/upload")
async def upload_tex(request: Request):
    resolved = resolve_in_active_root(request.query_params.get("name", ""))
    if resolved is None:
        return JSONResponse({"ok": False}, status_code=400)
    _, full_path = resolved
    content = await request.body()
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    return JSONResponse({"ok": True})


@app.post("/select")
async def select_file(request: Request):
    global TEX_FILE, PDF_FILE
    resolved = resolve_in_active_root((await request.body()).decode().strip())
    if resolved is None:
        return JSONResponse({"ok": False}, status_code=400)
    relative, full_path = resolved
    if relative.suffix != ".tex" or not full_path.is_file():
        return JSONResponse({"ok": False}, status_code=400)
    TEX_FILE = relative
    PDF_FILE = TEX_FILE.with_suffix(".pdf")
    file_str = str(TEX_FILE)
    if file_str in queued_files:
        state = "compiling" if compiling_now == file_str else "queued"
    else:
        remove_aux_files()
        state = "idle"
    return JSONResponse({"ok": True, "file": file_str, "compile_state": state})


@app.post("/save")
async def save_tex(request: Request):
    if TEX_FILE is None:
        return JSONResponse({"ok": False}, status_code=400)
    content = (await request.body()).decode()
    full_tex_path().write_text(content)
    return JSONResponse({"ok": True})


@app.post("/compile")
async def compile_tex(request: Request):
    if TEX_FILE is None:
        return JSONResponse(
            {"ok": False, "log": "No .tex file selected yet - use Open to add one."},
            status_code=400,
        )
    file_str = str(TEX_FILE)
    content = (await request.body()).decode()
    full_tex_path().write_text(content)
    compile_pdf_only[file_str] = request.query_params.get("pdf_only") == "1"
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
        state = "compiling" if compiling_now == file else "queued"
        return JSONResponse({"state": state})
    result = compile_results.get(file)
    if result is None:
        return JSONResponse({"state": "idle"})
    return JSONResponse({"state": "done", "ok": result["ok"], "log": result["log"]})


@app.get("/compile-queue")
def get_compile_queue():
    return JSONResponse({"compiling": compiling_now, "queued": sorted(queued_files)})


@app.get("/pdf")
def get_pdf():
    if PDF_FILE is None or not full_pdf_path().exists():
        return JSONResponse({"error": "no pdf"}, status_code=404)
    return FileResponse(full_pdf_path(), media_type="application/pdf")


@app.websocket("/ws")
async def session_socket(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

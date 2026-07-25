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


compile_lock = asyncio.Lock()
current_process = None


def remove_aux_files():
    base = str(full_tex_path().with_suffix(""))
    for ext in AUX_EXTENSIONS:
        Path(f"{base}.{ext}").unlink(missing_ok=True)

app = FastAPI()
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
    if current_process is not None and current_process.returncode is None:
        current_process.terminate()
    TEX_FILE = relative
    PDF_FILE = TEX_FILE.with_suffix(".pdf")
    remove_aux_files()
    return JSONResponse({"ok": True, "file": str(TEX_FILE)})


@app.post("/save")
async def save_tex(request: Request):
    if TEX_FILE is None:
        return JSONResponse({"ok": False}, status_code=400)
    content = (await request.body()).decode()
    full_tex_path().write_text(content)
    return JSONResponse({"ok": True})


@app.post("/compile")
async def compile_tex(request: Request):
    global current_process
    if TEX_FILE is None:
        return JSONResponse(
            {"ok": False, "log": "No .tex file selected yet - use Open to add one."},
            status_code=400,
        )
    content = (await request.body()).decode()
    full_tex_path().write_text(content)
    async with compile_lock:
        process = await asyncio.create_subprocess_exec(
            "latexmk", "-pdf", "-interaction=nonstopmode", "-halt-on-error", TEX_FILE.name,
            cwd=str(full_tex_path().parent),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        current_process = process
        stdout, stderr = await process.communicate()
        current_process = None
    ok = process.returncode == 0 and full_pdf_path().exists()
    if ok and request.query_params.get("pdf_only") == "1":
        remove_aux_files()
    log = (stdout.decode(errors="replace") + stderr.decode(errors="replace"))[-4000:]
    return JSONResponse({"ok": ok, "log": log})


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

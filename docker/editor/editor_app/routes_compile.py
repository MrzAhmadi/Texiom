import re
import subprocess

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse

from .compiler import compile_queue, compile_results, compiling_now, dirty_during_compile, queued_files
from .workspace import workspace

router = APIRouter()


@router.post("/compile")
async def compile_tex():
    if workspace.tex_file is None:
        return JSONResponse(
            {"ok": False, "log": "No .tex file selected yet - create or open one in the sidebar."},
            status_code=400,
        )
    file_str = str(workspace.tex_file)
    if file_str in queued_files:
        dirty_during_compile.add(file_str)
    else:
        queued_files.add(file_str)
        compile_results.pop(file_str, None)
        await compile_queue.put(file_str)
    return JSONResponse({"ok": True})


@router.get("/compile-status")
def compile_status(file: str):
    if file in queued_files:
        state = "compiling" if file in compiling_now else "queued"
        return JSONResponse({"state": state})
    result = compile_results.get(file)
    if result is None:
        return JSONResponse({"state": "idle"})
    return JSONResponse({"state": "done", "ok": result["ok"], "log": result["log"]})


@router.get("/compile-queue")
def get_compile_queue():
    return JSONResponse({"compiling": sorted(compiling_now), "queued": sorted(queued_files)})


def run_synctex(args):
    result = subprocess.run(
        ["synctex", *args],
        capture_output=True, text=True, cwd=str(workspace.full_tex_path().parent),
    )
    data = {}
    for line in result.stdout.splitlines():
        match = re.match(r"^(\w+):(.*)$", line)
        if match:
            data[match.group(1)] = match.group(2)
    return data


@router.get("/synctex/forward")
def synctex_forward(line: int, column: int = 1):
    if workspace.tex_file is None or not workspace.full_pdf_path().exists():
        return JSONResponse({"ok": False}, status_code=400)
    data = run_synctex([
        "view", "-i", f"{line}:{column}:{workspace.full_tex_path()}", "-o", str(workspace.full_pdf_path()),
    ])
    if "Page" not in data:
        return JSONResponse({"ok": False}, status_code=404)
    return JSONResponse({
        "ok": True,
        "page": int(data["Page"]),
        "x": float(data.get("x", 0)),
        "y": float(data.get("y", 0)),
    })


@router.get("/synctex/inverse")
def synctex_inverse(page: int, x: float, y: float):
    if workspace.tex_file is None or not workspace.full_pdf_path().exists():
        return JSONResponse({"ok": False}, status_code=400)
    data = run_synctex(["edit", "-o", f"{page}:{x}:{y}:{workspace.full_pdf_path()}"])
    if "Line" not in data:
        return JSONResponse({"ok": False}, status_code=404)
    return JSONResponse({"ok": True, "line": int(data["Line"]), "column": int(data.get("Column", -1))})


@router.get("/pdf")
def get_pdf():
    if workspace.pdf_file is None or not workspace.full_pdf_path().exists():
        return JSONResponse({"error": "no pdf"}, status_code=404)
    return FileResponse(workspace.full_pdf_path(), media_type="application/pdf")

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from .compiler import compiling_now, queued_files, remove_aux_files
from .workspace import STATIC_DIR, WORKSPACE_ROOT, is_hidden, resolve_in_workspace, workspace

router = APIRouter()


@router.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/source", response_class=PlainTextResponse)
def get_source():
    return workspace.full_editing_path().read_text() if workspace.editing_file else ""


@router.get("/current")
def get_current():
    return JSONResponse({
        "file": str(workspace.editing_file) if workspace.editing_file else None,
        "tex_file": str(workspace.tex_file) if workspace.tex_file else None,
        "open_tabs": workspace.open_tabs,
    })


@router.post("/state/tabs")
async def set_open_tabs(request: Request):
    body = await request.json()
    tabs = []
    for p in body.get("tabs", []):
        resolved = resolve_in_workspace(str(p))
        if resolved is not None and resolved[1].is_file():
            tabs.append(str(resolved[0]))
    workspace.set_open_tabs(tabs)
    return JSONResponse({"ok": True})


@router.post("/deselect")
async def deselect_file():
    workspace.deselect()
    return JSONResponse({"ok": True})


@router.get("/tree")
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
        "current": str(workspace.editing_file) if workspace.editing_file else None,
        "tex_file": str(workspace.tex_file) if workspace.tex_file else None,
    })


@router.post("/select")
async def select_file(request: Request):
    resolved = resolve_in_workspace((await request.body()).decode().strip())
    if resolved is None:
        return JSONResponse({"ok": False}, status_code=400)
    relative, full_path = resolved
    if relative.suffix not in (".tex", ".bib") or not full_path.is_file():
        return JSONResponse({"ok": False}, status_code=400)

    workspace.select(relative)

    if relative.suffix != ".tex":
        return JSONResponse({
            "ok": True,
            "file": str(workspace.editing_file),
            "is_tex": False,
            "compile_state": "idle",
        })

    file_str = str(workspace.tex_file)
    if file_str in queued_files:
        state = "compiling" if file_str in compiling_now else "queued"
    else:
        remove_aux_files()
        state = "idle"
    return JSONResponse({"ok": True, "file": file_str, "is_tex": True, "compile_state": state})


@router.post("/save")
async def save_tex(request: Request):
    if workspace.editing_file is None:
        return JSONResponse({"ok": False}, status_code=400)
    content = (await request.body()).decode()
    path = workspace.full_editing_path()
    if not content.strip() and path.exists() and path.stat().st_size > 0:
        return JSONResponse(
            {"ok": False, "log": "Refusing to overwrite a non-empty file with empty content."},
            status_code=409,
        )
    path.write_text(content)
    return JSONResponse({"ok": True})

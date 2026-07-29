import io
import shutil
import zipfile
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from .compiler import HIDDEN_TREE_SUFFIXES, is_build_artifact
from .workspace import WORKSPACE_ROOT, is_hidden, resolve_in_workspace, workspace

router = APIRouter()


@router.post("/fs/create-folder")
async def create_folder(request: Request):
    resolved = resolve_in_workspace((await request.body()).decode().strip())
    if resolved is None:
        return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
    _, full_path = resolved
    if full_path.exists():
        return JSONResponse({"ok": False, "error": "already exists"}, status_code=409)
    full_path.mkdir(parents=True)
    return JSONResponse({"ok": True})


@router.post("/fs/create-file")
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


@router.post("/fs/rename")
async def rename_path(request: Request):
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
        return JSONResponse(
            {"ok": False, "error": "a file or folder with that name already exists"}, status_code=409
        )

    to_full.parent.mkdir(parents=True, exist_ok=True)
    from_full.rename(to_full)
    workspace.remap_after_rename(from_rel, to_rel)

    return JSONResponse({
        "ok": True,
        "editing_file": str(workspace.editing_file) if workspace.editing_file else None,
        "open_tabs": workspace.open_tabs,
    })


@router.post("/fs/delete")
async def delete_path(request: Request):
    resolved = resolve_in_workspace((await request.body()).decode().strip())
    if resolved is None:
        return JSONResponse({"ok": False, "error": "invalid path"}, status_code=400)
    relative, full_path = resolved
    if not full_path.exists():
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)

    closed_current = workspace.clear_after_delete(relative)

    if full_path.is_dir():
        shutil.rmtree(full_path)
    else:
        full_path.unlink()
        base = str(full_path.with_suffix(""))
        for ext in HIDDEN_TREE_SUFFIXES:
            Path(f"{base}.{ext}").unlink(missing_ok=True)

    return JSONResponse({"ok": True, "closed_current": closed_current, "open_tabs": workspace.open_tabs})


@router.get("/fs/download")
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


@router.post("/upload")
async def upload_file(request: Request):
    resolved = resolve_in_workspace(request.query_params.get("name", ""))
    if resolved is None:
        return JSONResponse({"ok": False}, status_code=400)
    _, full_path = resolved
    content = await request.body()
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(content)
    return JSONResponse({"ok": True})

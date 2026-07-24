#!/usr/bin/env python3
import argparse
import subprocess
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"

parser = argparse.ArgumentParser()
parser.add_argument("--file", required=True)
args = parser.parse_args()

TEX_FILE = Path(args.file)
PDF_FILE = TEX_FILE.with_suffix(".pdf")

app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/source", response_class=PlainTextResponse)
def get_source():
    return TEX_FILE.read_text()


@app.post("/compile")
async def compile_tex(request: Request):
    content = (await request.body()).decode()
    TEX_FILE.write_text(content)
    result = subprocess.run(
        ["latexmk", "-pdf", "-interaction=nonstopmode", "-halt-on-error", str(TEX_FILE)],
        capture_output=True,
        text=True,
    )
    ok = result.returncode == 0 and PDF_FILE.exists()
    return JSONResponse({"ok": ok, "log": (result.stdout + result.stderr)[-4000:]})


@app.get("/pdf")
def get_pdf():
    return FileResponse(PDF_FILE, media_type="application/pdf")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

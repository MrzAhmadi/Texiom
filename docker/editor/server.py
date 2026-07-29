#!/usr/bin/env python3
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from editor_app import routes_compile, routes_fs, routes_workspace, session
from editor_app.compiler import WORKER_COUNT, compile_worker
from editor_app.workspace import STATIC_DIR


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


app.include_router(routes_workspace.router)
app.include_router(routes_fs.router)
app.include_router(routes_compile.router)
app.include_router(session.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

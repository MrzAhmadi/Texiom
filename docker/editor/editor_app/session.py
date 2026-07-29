from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
active_sockets = set()


@router.websocket("/ws")
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

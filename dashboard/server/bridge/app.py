"""ASGI application: Socket.IO for the live push + a small REST API + the built UI.

    browser  <--Socket.IO--  this bridge  <--aiokafka--  Flink output topics

The endpoints that read the state are `async`, so they run on the event loop and
never see the state half-way through an update by the Kafka feed. They return a
JSONResponse directly: FastAPI's generic encoder is slow for snapshots this size.
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager

import socketio
import uvicorn
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import parse_args
from .kafka_feed import run_forever
from .timeline import Timeline

log = logging.getLogger("bridge")

EMPTY_GEOJSON = {"type": "FeatureCollection", "features": []}


class GeoJsonFile:
    """Reads links.geojson lazily and re-reads it when the file changes,
    so the bridge can start before the producer has downloaded it."""

    def __init__(self, path):
        self.path = path
        self._mtime = None
        self._data = EMPTY_GEOJSON

    def load(self):
        try:
            mtime = self.path.stat().st_mtime
            if mtime != self._mtime:
                self._data = json.loads(self.path.read_text(encoding="utf-8"))
                self._mtime = mtime
                log.info("loaded %d links from %s", len(self._data["features"]), self.path)
        except FileNotFoundError:
            pass  # not downloaded yet, the UI asks again later
        except ValueError:
            log.warning("%s is not valid JSON yet (still being written?)", self.path)
        return self._data


def create_app(config):
    timeline = Timeline(keep_ms=int(config.history_hours * 3600 * 1000))
    state = timeline.live
    geojson = GeoJsonFile(config.links_geojson)
    sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

    @sio.event
    async def connect(sid, environ):
        # A new (or reconnecting) browser gets the full current picture at once.
        await sio.emit("snapshot", state.snapshot(), to=sid)

    @asynccontextmanager
    async def lifespan(_app):
        task = asyncio.create_task(run_forever(config, timeline, sio))
        yield
        task.cancel()

    api = FastAPI(title="Traffic dashboard bridge", lifespan=lifespan)

    @api.get("/api/links")
    def links():
        return geojson.load()

    @api.get("/api/snapshot")
    async def snapshot():
        return JSONResponse(state.snapshot())

    @api.get("/api/timeline")
    async def timeline_summary():
        """The event-time range the dashboard can travel over, with the network speed series."""
        return JSONResponse(timeline.summary())

    @api.get("/api/state")
    async def state_at(at: int = Query(..., description="event time in epoch ms")):
        """The snapshot as it was at event time `at` (rebuilt from the nearest checkpoint,
        a few milliseconds, so it runs right here on the event loop)."""
        return JSONResponse(timeline.state_at(at).snapshot())

    @api.get("/api/health")
    async def health():
        return {"ok": True, "topics": config.topics, "event_clock": state.event_clock}

    if config.web_dist.is_dir():
        api.mount("/", StaticFiles(directory=config.web_dist, html=True), name="web")
    else:
        log.info("no built UI at %s (use `npm run dev` in dashboard/web)", config.web_dist)

    return socketio.ASGIApp(sio, other_asgi_app=api)


def main(argv=None):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = parse_args(argv)
    uvicorn.run(create_app(config), host=config.host, port=config.port, log_level="warning")


if __name__ == "__main__":
    main()

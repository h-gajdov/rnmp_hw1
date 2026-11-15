# Live dashboard (bonus)

A web page that shows the output of both Flink modules **while the stream is flowing**:
a map of NYC with every monitored road segment colored by congestion, the incident
alerts as they are detected, counters per alert type and per-borough speed over time.

```
Flink ──► Kafka topics ──► Python bridge ──Socket.IO (WebSocket)──► React app
          traffic-link-stats      dashboard/server        dashboard/web
          traffic-borough-stats   (aiokafka + python-socketio)
          traffic-incidents
          traffic-readings, traffic-late-readings (optional)
```

- **Bridge** (`server/bridge/`): one asyncio process. An `aiokafka` consumer reads the
  topics; every record is applied to an in-memory snapshot (`state.py`) and pushed to all
  browsers immediately (no polling, no batching; measured ~2–4 ms from Kafka write to
  Socket.IO delivery). When a browser connects or reconnects it first gets the full
  `snapshot`, so a freshly opened page is populated at once. The same process serves
  `GET /api/links` (the static `data/links.geojson`), `GET /api/snapshot`, `GET /api/health`
  and, in production, the built React app.
- **Web app** (`web/`, React + TypeScript + Vite): `useLiveFeed` holds the Socket.IO
  connection (auto-reconnect) and a reducer that mirrors the bridge state; incoming events
  are applied in 30 ms batches so a burst of 125 windows causes one render. The map is
  MapLibre GL on the free CARTO dark basemap (retinted); link colors use feature state and fade over
  ~1 s to each new window. The header shows the stream's event-time clock (New York time)
  and the connection health (Live / Reconnecting, messages per second, age of last message).
- **Boroughs**: the five boroughs are drawn as tinted, labelled areas from
  `web/public/boroughs.geojson` (NYC Open Data "Borough Boundaries", water-clipped, simplified to
  ~30 m with shapely, 76 KB, served as a static file of the built app). Hovering a borough on the
  map or its card in the bottom strip highlights it on both; clicking focuses it: the map zooms to
  it, the other boroughs and their links recede and the incident lists are narrowed to it.
- **Traffic flow**: dots move along every link at a screen speed proportional to the link's
  latest `avg_speed_mph` (silent sensors and links without data have none), in the travel
  direction from the link name (N/S/E/W), since the DOT polylines are not always drawn that way.
  The *Traffic flow* panel shows the network speed per 5-minute window (borough windows combined,
  weighted by readings) and the share of links at each congestion level per window (from the
  link history). Both are computed in the browser from the existing topics; the message
  contract is unchanged. The flow, incident and borough layers can be switched off in the legend.

Congestion levels follow the contract: ratio = avg speed / free-flow speed,
`>= 0.75` free flow (green), `>= 0.5` moderate (yellow), `>= 0.3` heavy (orange), else severe (red).
Links that never had a valid reading are drawn dark grey ("No data"), silent sensors light grey.

## Setup

Requires `uv` and Node 20.19+/22.12+. The bridge pins Python 3.12 (`server/.python-version`),
because Kafka client wheels are not available for the system Python 3.15 yet; `uv` uses or
downloads 3.12 automatically.

```bash
cd dashboard/server && uv sync          # Python deps (incl. pytest)
cd dashboard/web && npm install         # web deps
```

## Run

Development (hot reload; Vite proxies `/socket.io` and `/api` to the bridge on :8000):

```bash
cd dashboard/server && uv run python -m bridge          # terminal 1
cd dashboard/web && npm run dev                         # terminal 2, open http://localhost:5173
```

Production (one process, one port):

```bash
cd dashboard/web && npm run build
cd dashboard/server && uv run python -m bridge          # open http://localhost:8000
```

Docker (multi-stage: builds the UI, then runs the bridge on port 8000; build context is `dashboard/`):

```bash
docker build -t traffic-dashboard dashboard
docker run --rm -p 8000:8000 --network <kafka-network> \
  -e KAFKA_BOOTSTRAP=kafka:9093 -v "$PWD/data:/data:ro" traffic-dashboard
```

## Bridge options

Every flag can also be set with an environment variable (the flag wins).

| Flag | Env var | Default |
|---|---|---|
| `--bootstrap` | `KAFKA_BOOTSTRAP` | `localhost:9092` (image: `kafka:9093`) |
| `--link-stats-topic` | `LINK_STATS_TOPIC` | `traffic-link-stats` |
| `--borough-stats-topic` | `BOROUGH_STATS_TOPIC` | `traffic-borough-stats` |
| `--incidents-topic` | `INCIDENTS_TOPIC` | `traffic-incidents` |
| `--readings-topic` | `READINGS_TOPIC` | `traffic-readings` (empty = off) |
| `--late-topic` | `LATE_TOPIC` | `traffic-late-readings` (empty = off) |
| `--topic-prefix` | `TOPIC_PREFIX` | empty (prepended to every topic) |
| `--offset earliest\|latest` | `OFFSET` | `latest` |
| `--host` / `--port` | `HOST` / `PORT` | `0.0.0.0` / `8000` |
| `--links-geojson` | `LINKS_GEOJSON` | `data/links.geojson` (image: `/data/links.geojson`) |
| `--web-dist` | `WEB_DIST` | `dashboard/web/dist` |

`--offset latest` shows only what happens after the bridge starts (plus whatever it has
collected since); use `--offset earliest` to rebuild the picture from everything in the topics.

The bridge is safe to start before everything else: it retries until Kafka is reachable,
subscribes with a topic *pattern* so it never auto-creates topics and picks them up once
they exist (checked every 5 s), and re-reads `links.geojson` when it appears or changes;
the page asks `/api/links` again every 5 s until it gets the geometry.

## Fake feed (development without Flink)

`server/fake_feed.py` simulates all links on an accelerated event-time clock and publishes
contract-shaped messages: raw readings, 15/5-minute sliding link stats, 5-minute borough
stats and incident lifecycles (SPEED_DROP → PERSISTENT_CONGESTION → RECOVERY, SENSOR_SILENT).
About a third of the links never report, like the faulty sensors in the real data.
It writes to prefixed topics (default `dev-`), never to the real ones.

```bash
cd dashboard/server
uv run python fake_feed.py --prefix dev- --speedup 60      # terminal 1
uv run python -m bridge --topic-prefix dev-                # terminal 2
```

Other flags: `--start 2026-10-01T06:30:00` (New York time), `--incident-rate`,
`--silence-rate`, `--dead-share`, `--seed`, `--links-geojson`, `--bootstrap`.

## Tests

```bash
cd dashboard/server && uv run pytest        # snapshot/state logic, no Kafka needed
cd dashboard/web && npm run build           # type check (tsc) + production build
```

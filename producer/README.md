# Producer

Replays one day of NYC DOT real-time traffic speeds into Kafka topic `traffic-readings`
(message format: `docs/CONTRACT.md`).

| File | Purpose |
|------|---------|
| `download_data.py` | downloads `data/traffic.csv` and `data/links.geojson` from the NYC Open Data API (stdlib only) |
| `replay.py` | pure logic: cleaning, time conversion, out-of-order schedule (unit tested) |
| `producer.py` | CLI: Kafka topic creation, real-time pacing, sending |
| `entrypoint.sh`, `Dockerfile` | container image (downloads the data on first start) |
| `run.sh` | local helper: creates the venv, downloads data if missing, runs the producer |

## Setup (local)

Python 3.12 venv managed by `uv` (the system Python 3.15 has no `confluent-kafka` wheels yet):

```sh
cd producer
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt -r requirements-dev.txt
```

## Commands (from the repository root)

```sh
python3 producer/download_data.py                       # 2026-10-01 -> data/traffic.csv + data/links.geojson
python3 producer/download_data.py --start 2026-10-02 --end 2026-10-04 --out data/traffic.csv

producer/.venv/bin/python producer/producer.py --input data/traffic.csv          # 1 h of data per minute
producer/.venv/bin/python producer/producer.py --input data/traffic.csv --speedup 300 --start-at 07:00
producer/run.sh --speedup 120                           # same, with automatic setup

producer/.venv/bin/python -m pytest -q producer/tests   # unit tests
```

## Flags

Every flag can also be set with the environment variable in brackets (used by Docker).

| Flag | Default | |
|------|---------|---|
| `--bootstrap` [`KAFKA_BOOTSTRAP`] | `localhost:9092` | `kafka:9093` inside the Docker network |
| `--topic` [`TOPIC`] | `traffic-readings` | created if missing |
| `--partitions` [`PARTITIONS`] | `4` | used only when the topic is created |
| `--input` [`INPUT`] | `data/traffic.csv` | |
| `--speedup` [`SPEEDUP`] | `60` | event-time seconds per wall second; `0` = as fast as possible |
| `--disorder-ratio` [`DISORDER_RATIO`] | `0.1` | share of records sent out of order |
| `--max-delay-s` [`MAX_DELAY_S`] | `120` | max event-time delay of such a record |
| `--seed` [`SEED`] | `42` | makes the disorder reproducible |
| `--limit` [`LIMIT`] | `0` (all) | stop after N records |
| `--start-at` [`START_AT`] | – | skip to a NY time of day, e.g. `07:00` |
| `--loop` [`LOOP=true`] | off | replay forever, each round shifted one day later |
| `--progress-s` [`PROGRESS_S`] | `5` | seconds between progress lines |
| `--kafka-wait-s` [`KAFKA_WAIT_S`] | `120` | how long to retry until Kafka is reachable |

Docker only: `DATA_START` (default `2026-10-01`) and `DATA_END` choose what is downloaded when
`/data/traffic.csv` or `/data/links.geojson` is missing. Mount a volume at `/data`.

```sh
docker build -t rnmp-producer producer
docker run --rm --network <kafka network> -v "$PWD/data:/data" -e SPEEDUP=120 rnmp-producer
```

## How it works

1. **Cleaning.** Rows with `status != 0` or `speed <= 0` are sensor faults and are dropped, as are
   duplicate `(link_id, data_as_of)` pairs. The counts are logged at startup.
2. **Event time.** `data_as_of` is New York wall-clock time without an offset; it is interpreted in
   `America/New_York` (so EDT/EST is handled) and converted to epoch milliseconds `event_time`.
3. **Disorder.** Each record is sent at its *release time*. Normally that is its event time; with
   probability `--disorder-ratio` it is `event_time + d`, `d` random in `(0, --max-delay-s]`. Sorting by
   release time puts the delayed record after records that happened later. These are marked `"delayed": true`.
4. **Real time.** The wall-clock wait before a record is `(release time − first release time) / speedup`,
   measured from the start, so records with the same timestamp go out together and there is no drift.
5. **Kafka.** Key = `link_id` (all readings of a link land in the same partition), value = contract JSON.
   Ctrl+C / `docker stop` flushes the pending messages before exiting.

### Relation to the Flink watermark

A delayed record is sent no later than its release time `event_time + d`, and every record sent before it has
an event time `<= event_time + d`. So **no record is ever more than `--max-delay-s` (120 s) of event time
behind the newest record already sent.** With `WatermarkStrategy.forBoundedOutOfOrderness(120 s)` the
watermark is always below the event time of a delayed record when it arrives, so nothing is dropped, and
windows close 120 s of event time (2 s of wall time at speedup 60) after their end.

To demonstrate the late-data side output, run Flink with a *smaller* bound than the producer's delay
(e.g. Flink `--max-ooo-s 30` with producer `--max-delay-s 120`): delayed records that fall behind the
watermark are then routed to `traffic-late-readings`.

## Data facts (2026-10-01)

- 125 links, every link reports every ~5 minutes → 36 000 rows/day; timestamps are irregular (2 675 distinct
  `data_as_of` values, 1–46 readings each).
- 14 927 rows are faults (`status = -101`, speed 0); **21 073 readings remain**. Only 81 links ever
  report valid data, the other 44 are faulty all day.
- Per-link gap between valid readings: normally 5 min, sometimes 10–35 min, maximum 5.6 h (sensor outages).
- Geometry: `link_points` is truncated at 255 characters and has corrupted numbers, so `links.geojson` is
  built from `encoded_poly_line` after undoing the API's broken backslash escaping; points outside the NYC
  bounding box and isolated spikes are dropped.

# Message contract

Every module (Python producer, Java Flink job, dashboard bridge + React UI) depends on this file.
All messages are UTF-8 JSON objects. Timestamps are **epoch milliseconds (UTC)** unless the field name
says otherwise. Field names are `snake_case`. Unknown fields must be ignored by consumers.

## Dataset

NYC DOT Real-Time Traffic Speed Data, Socrata dataset `i4gi-tjb9`
(https://data.cityofnewyork.us/Transportation/DOT-Traffic-Speeds-NBE/i4gi-tjb9).
~125 road segments ("links"), one reading per link roughly every 5 minutes.

- `data_as_of` is New York local time without an offset (e.g. `2026-10-01T00:28:10.000`).
  It is converted with zone `America/New_York` to epoch ms → `event_time`.
- Readings with `status != 0` or `speed <= 0` are sensor faults and are **dropped by the producer**
  (counted and logged, never sent).
- Exact duplicates `(link_id, data_as_of)` are dropped by the producer.

**Partition key everywhere: `link_id`** (string). Borough topics are keyed by `borough`.

## Static file: `data/links.geojson`

Written by `producer/download_data.py` (not a Kafka topic, the geometry is static metadata).
A GeoJSON `FeatureCollection` of `LineString`s, coordinates `[lon, lat]`, one feature per link:

```json
{ "type": "Feature",
  "properties": { "link_id": "4616253", "link_name": "CBE E TAYLOR AVENUE - CASTLE HILL AVENUE", "borough": "Bronx" },
  "geometry": { "type": "LineString", "coordinates": [[-73.86593, 40.8347204], [-73.86199, 40.83357]] } }
```

## Topics

| Topic                    | Producer       | Key        | Partitions | Content                                   |
|--------------------------|----------------|------------|-----------:|-------------------------------------------|
| `traffic-readings`       | Python producer| `link_id`  | 4          | raw readings (input)                      |
| `traffic-link-stats`     | Flink analytics| `link_id`  | 4          | sliding-window stats per link             |
| `traffic-borough-stats`  | Flink analytics| `borough`  | 4          | tumbling-window stats per borough         |
| `traffic-incidents`      | Flink event-driven | `link_id` | 4      | incident lifecycle alerts                  |
| `traffic-late-readings`  | Flink          | `link_id`  | 4          | readings too late for their window (side output) |

Topic names are configurable via CLI flags in every module; the names above are the defaults.

### `traffic-readings`

```json
{
  "link_id": "4616253",
  "link_name": "CBE E TAYLOR AVENUE - CASTLE HILL AVENUE",
  "borough": "Bronx",
  "speed_mph": 42.25,
  "travel_time_s": 60,
  "data_as_of": "2026-10-01T00:28:10.000",
  "event_time": 1790828890000,
  "sent_at": 1763215000123,
  "delayed": false
}
```

`sent_at` = wall-clock ms when the producer sent it; `delayed` = true when the producer deliberately
sent this record out of order (debug / demo only, Flink must not rely on it).

### `traffic-link-stats` (analytics module, per link, sliding window 15 min size / 5 min slide, event time)

```json
{
  "link_id": "4616253",
  "link_name": "CBE E TAYLOR AVENUE - CASTLE HILL AVENUE",
  "borough": "Bronx",
  "window_start": 1790829000000,
  "window_end": 1790829900000,
  "count": 3,
  "avg_speed_mph": 38.1,
  "min_speed_mph": 31.0,
  "max_speed_mph": 42.25,
  "stddev_speed_mph": 4.6,
  "avg_travel_time_s": 72.3,
  "free_flow_mph": 44.0,
  "congestion_ratio": 0.866,
  "level": "FREE"
}
```

- `free_flow_mph`: per-link reference speed kept in keyed state across windows
  (estimate of the uncongested speed, e.g. a slowly-decaying high percentile / max of window averages).
- `congestion_ratio = avg_speed_mph / free_flow_mph`, clamped to `[0, 1]`.
- `level` from the ratio: `>= 0.75 FREE`, `>= 0.50 MODERATE`, `>= 0.30 HEAVY`, `< 0.30 SEVERE`.

### `traffic-borough-stats` (analytics module, per borough, tumbling window 5 min, event time)

```json
{
  "borough": "Manhattan",
  "window_start": 1790829000000,
  "window_end": 1790829300000,
  "readings": 41,
  "links": 37,
  "avg_speed_mph": 21.4,
  "min_speed_mph": 3.1,
  "max_speed_mph": 48.0,
  "slow_readings": 6,
  "slow_share": 0.146
}
```

`slow_readings` = readings with `speed_mph < 15`. `slow_share = slow_readings / readings`.

### `traffic-incidents` (event-driven module, `KeyedProcessFunction` keyed by `link_id`, state + event-time timers)

```json
{
  "alert_id": "4616253-1790828890000-SPEED_DROP",
  "type": "SPEED_DROP",
  "link_id": "4616253",
  "link_name": "CBE E TAYLOR AVENUE - CASTLE HILL AVENUE",
  "borough": "Bronx",
  "event_time": 1790828890000,
  "incident_start": 1790828890000,
  "duration_s": 0,
  "speed_mph": 12.4,
  "baseline_mph": 44.0,
  "ratio": 0.28,
  "min_speed_mph": 12.4,
  "severity": "HIGH",
  "message": "Speed fell to 12.4 mph (28% of the usual 44.0 mph)"
}
```

`type` is one of:

| type                     | when                                                                                       |
|--------------------------|--------------------------------------------------------------------------------------------|
| `SPEED_DROP`             | link was NORMAL and a reading falls below 50% of the link's baseline → incident opens      |
| `PERSISTENT_CONGESTION`  | event-time timer (15 min after the drop) fires, the link has not recovered and its latest reading is still slow |
| `RECOVERY`               | link in an incident and 2 consecutive readings are back above 75% of baseline (hysteresis) |
| `SENSOR_SILENT`          | event-time timer: no reading from the link for 20 min (watermark passed last_seen + 20 min) |

`severity`: `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`. For `SPEED_DROP` / `PERSISTENT_CONGESTION` from the ratio
(`< 0.15` CRITICAL, `< 0.30` HIGH, `< 0.40` MEDIUM, else LOW), one level higher at 15+ min and again at 60+ min
of duration; `RECOVERY` is always `LOW`, `SENSOR_SILENT` always `MEDIUM`. For `RECOVERY`,
`duration_s` is the full incident duration and `min_speed_mph` the worst speed seen in it.
For `SENSOR_SILENT`, `incident_start` is the time of the last reading, `duration_s` the silence so far and the
speed fields describe the last reading. `ratio` is `speed_mph / baseline_mph` (not clamped, can be > 1).
`event_time` of timer alerts (`PERSISTENT_CONGESTION`, `SENSOR_SILENT`) is the deadline itself
(drop + 15 min, last_seen + 20 min).
Thresholds (50%, 75%, 15 min, 20 min, 2 readings) are configurable CLI flags.

Link state machine: `NORMAL → DROPPED → CONGESTED → (RECOVERY) → NORMAL`; `DROPPED → NORMAL` is also a
recovery (short incident).

### `traffic-late-readings`

The original `traffic-readings` JSON plus `"late_by_ms"` (current watermark − event_time).

## Event time and watermarks

- Producer: replays in `event_time` order with a speed-up factor (default `--speedup 60`: one hour of data per
  minute) and sends a fraction of records out of order (default `--disorder-ratio 0.1`,
  `--max-delay-s 120` of **event time**): a delayed record is held back and emitted after later records.
- Flink: `WatermarkStrategy.forBoundedOutOfOrderness(--max-ooo-s, default 120)` + `withIdleness`,
  timestamps from `event_time`. Records later than watermark go to `traffic-late-readings`.
- Flink takes `--offset earliest|latest` for the Kafka source starting offset.

## Defaults

- Kafka bootstrap: `localhost:9092` from the host; `kafka:9093` from inside the course Docker network.
- Kafka is started from the course repo (`stefanandonov/RNMP_homework1`, `docker compose up -d --wait`).

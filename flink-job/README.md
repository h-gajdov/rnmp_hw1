# Flink job: NYC traffic analytics and incident detection

Flink 2.3 / Java 17 DataStream job. Reads `traffic-readings` from Kafka and writes four topics
(message formats: [`docs/CONTRACT.md`](../docs/CONTRACT.md)).

```
traffic-readings ─► watermarks ─► late filter ─┬─► keyBy link    ─► sliding 15m/5m window ─► traffic-link-stats
                                      │        ├─► keyBy borough ─► tumbling 5m window    ─► traffic-borough-stats
                                      │        └─► keyBy link    ─► IncidentDetector       ─► traffic-incidents
                                      └─(side output)────────────────────────────────────► traffic-late-readings
```

| Package / class | What it does |
|---|---|
| `TrafficIncidentJob` | `main()`: source, watermarks, the three branches, sinks |
| `JobConfig` | command-line flags (below) |
| `LateReadingFilter` | readings at or behind the watermark → side output `traffic-late-readings` |
| `analytics/LinkStats*` | per link, sliding window 15 min / 5 min: count, avg/min/max/stddev speed, travel time, `free_flow_mph` (kept across windows in `context.globalState()`), `congestion_ratio`, `level` |
| `analytics/BoroughStats*` | per borough, tumbling 5 min: readings, distinct links, avg/min/max speed, share of readings below 15 mph |
| `detection/IncidentDetector` | `KeyedProcessFunction` per link with state and event-time timers (state machine below) |
| `kafka/` | JSON (Jackson, snake_case) source deserializer and keyed sink serializer |
| `model/` | POJOs = the JSON messages |

## Incident detection (event-driven module)

Per link, one `ValueState<LinkState>`: learned baseline speed, phase, current incident, timer times.

```
NORMAL ──reading < 50% of baseline──► DROPPED ──timer: 15 min later, not recovered──► CONGESTED
   ▲          (SPEED_DROP)               │              (PERSISTENT_CONGESTION)            │
   └───────────── 2 readings in a row ≥ 75% of baseline (RECOVERY) ◄─────────────────────┘
```

- **Baseline**: moving average (EWMA, alpha 0.1) of the link's speed, updated only while NORMAL, so an incident
  does not drag it down. The first 3 readings only learn it (warm-up, no alerts). After a silence of 20+ min the
  baseline is learned again (night → rush hour would make the old one misleading).
- **Hysteresis**: an incident opens below 50% but closes only at 75%, twice in a row, so a link hovering around
  50% does not flap.
- **Timers** (event time, i.e. they fire when the *watermark* passes them):
  - persistence timer at drop + 15 min → `PERSISTENT_CONGESTION` if the link has not recovered and its latest reading is still below the recovery threshold; deleted on recovery;
  - silence timer at last reading + 20 min, moved forward by every reading → `SENSOR_SILENT` (once per silence).
- If the next reading of a link already lies past a deadline whose timer has not fired yet (happens when a topic is
  read much faster than real time, `--offset earliest`), the reading handles that deadline first. Alerts therefore
  depend only on event times: an `earliest` run and a `latest` run over the same data give identical output.

## Build and test

Java 17 is pinned in `.mise.toml` (`mise install` once). Maven comes with the wrapper.

```sh
cd flink-job
./mvnw test              # 19 unit tests: window math, detector with Flink's operator test harness, JSON contract
./mvnw clean package     # fat jar: target/traffic-flink-job-1.0.jar (Kafka connector + Jackson inside, Flink "provided")
```

## Run locally (embedded mini-cluster, Kafka at localhost:9092)

```sh
cd flink-job
./mvnw -q compile exec:exec -Dexec.args="--offset earliest"
./mvnw -q compile exec:exec -Dexec.args="--offset latest --parallelism 4"
```

`exec:exec` starts a separate `java` (Java 17 from the PATH) with the Flink jars on the classpath.
(`exec:java` does not work: inside Maven's class loader Flink's mini-cluster cannot find its own classes.)
In IntelliJ just run `TrafficIncidentJob.main` (the `ide` profile puts the provided Flink jars on the classpath).

## Run on the Flink cluster (Docker)

**Option A: fat jar + `flink run`** (cluster containers `jobmanager`/`taskmanager`, Kafka inside Docker is `kafka:9093`):

```sh
./mvnw clean package -DskipTests
docker cp target/traffic-flink-job-1.0.jar jobmanager:/tmp/traffic-job.jar
docker exec jobmanager flink run -d /tmp/traffic-job.jar --bootstrap kafka:9093 --offset earliest
docker exec jobmanager flink list                 # cancel: docker exec jobmanager flink cancel <JobID>
```

Do not submit from the Web UI: in Flink 2.3 its *Program Arguments* field does not reach the job (see the course's
`CLUSTER.md`), so the job would try `localhost:9092`. The UI (http://localhost:8081) is fine for watching it.

**Option B: Docker image** (used by the root `docker compose`). `Dockerfile` builds the jar with Maven and puts it
into a `flink:2.3.0-java17` image at `/opt/flink/usrlib/traffic-job.jar`. Its entrypoint `submit-job.sh` waits
until the JobManager at `$JOBMANAGER` (default `jobmanager:8081`) has a TaskManager, submits the job detached with
the container's arguments and exits. If a job with the same name is already RUNNING it does nothing, so restarting
the container does not start a second copy.

```sh
docker build -t rnmp-flink-job flink-job
docker run --rm --network <compose network> rnmp-flink-job --bootstrap kafka:9093 --offset earliest
```

The output topics should exist with 4 partitions before the job writes (Kafka would otherwise auto-create them with
the broker default). Create the input topic before starting the job too: the source subscribes with a pattern, so a
missing topic does not crash the job (it is found within 10 s), but with `--offset latest` records written before it
is found are skipped.

## Flags

| Flag | Default | |
|---|---|---|
| `--bootstrap` | `localhost:9092` | `kafka:9093` inside Docker |
| `--offset` | `latest` | `earliest` = whole topic from the start, `latest` = only records produced after the job started |
| `--group-id` | `traffic-flink-job` | Kafka consumer group (offsets are committed on checkpoints, but the start is always `--offset`) |
| `--readings-topic` | `traffic-readings` | input |
| `--link-stats-topic` | `traffic-link-stats` | |
| `--borough-stats-topic` | `traffic-borough-stats` | |
| `--incidents-topic` | `traffic-incidents` | |
| `--late-topic` | `traffic-late-readings` | |
| `--max-ooo-s` | `120` | watermark bound (bounded out-of-orderness), seconds of event time |
| `--idle-s` | `30` | a partition without data for this long (wall clock) does not hold back the watermark |
| `--parallelism` | Flink default | e.g. `4` = one source subtask per partition |
| `--drop-ratio` | `0.5` | SPEED_DROP below this share of the baseline |
| `--recovery-ratio` | `0.75` | a reading at or above this share counts towards RECOVERY |
| `--recovery-readings` | `2` | that many such readings in a row close the incident |
| `--persistent-min` | `15` | PERSISTENT_CONGESTION check after the drop (event-time minutes) |
| `--silence-min` | `20` | SENSOR_SILENT after this many event-time minutes without a reading |
| `--warmup-readings` | `3` | readings that only learn the baseline |
| `--baseline-alpha` | `0.1` | EWMA weight of a new reading |

## Event time and watermarks

- The timestamp of every record is its `event_time` (when the sensor measured it), not when it reached Flink.
- `WatermarkStrategy.forBoundedOutOfOrderness(120 s)`: the watermark is always 120 s behind the largest event time
  seen so far, i.e. Flink promises itself "nothing older than this will come any more". The producer holds back about
  10% of the readings by up to `--max-delay-s 120` seconds of event time, so the bound equals the producer's worst
  disorder: no reading is late, and every window and timer waits at most 2 extra event-time minutes
  (2 s of wall clock at `--speedup 60`). A smaller bound gives faster results but loses delayed readings;
  try `--max-ooo-s 30` to see readings appear in `traffic-late-readings`.
- The Kafka source tracks a watermark per partition and the job uses the minimum. `withIdleness(30 s)` stops an
  empty partition (or a source subtask without partitions) from holding the watermark back forever.
- **Late readings**: a reading whose event time is at or behind the current watermark is sent to the side output
  `traffic-late-readings` with `late_by_ms = watermark − event_time` instead of being silently dropped by the windows.
  Watermarks are emitted periodically (every 200 ms), so when a topic is replayed at full speed (`--offset earliest`)
  the watermark lags behind and practically nothing is late; late readings show up in real-time runs.
- **When the data ends** the watermark stops advancing (there is no newer event time to derive it from, and idle
  partitions only stop holding it back, they do not push it forward). The windows whose end lies after
  `last event time − 120 s` never fire (the last 5-min borough window and the last 2-3 sliding windows per link),
  and pending timers (a 15-min persistence check, the 20-min silence timers of all links) never fire either.
  They stay in state and would complete as soon as new data arrives (e.g. the producer's `--loop`). The results of
  everything before that point are identical for `--offset earliest` and `--offset latest`.

Checkpoints every 10 s; the Kafka sinks are at-least-once (flushed on each checkpoint).

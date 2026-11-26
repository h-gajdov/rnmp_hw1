# Homework 1 - NYC traffic incident detection

**Изработил: Христијан Гајдов 231119**

## 1. Dataset and partition key

For the first homework assignment, I chose the public [NYC DOT Traffic Speeds dataset (i4gi-tjb9)](https://data.cityofnewyork.us/Transportation/DOT-Traffic-Speeds/i4gi-tjb9). The dataset contains measurements of vehicle speed and travel time, recorded roughly every five minutes per road segment. It covers multiple days and is updated daily. For this assignment, I used data from **1 October 2026**, which contains 36,000 rows across 125 segments, about 25 rows per minute. After excluding 14,927 faulty rows, the producer replays 21,073 readings from 81 segments.

Kafka keys each reading by `link_id` so a segment's readings stay in one partition. Flink uses the same key for segment windows and incident state. The borough aggregation groups readings by `borough`.

## 2. Architecture and Kafka topics

Flink reads the producer's Kafka stream and routes accepted readings to both modules. The dashboard reads the results through a Python bridge. Compose creates four partitions per topic. The [message contract](CONTRACT.md) specifies the JSON fields.

![Architecture from the NYC Open Data API through the Python producer, Kafka, and Flink to the dashboard](architecture.svg)

<p class="caption">Figure 1. Data flow from download to dashboard. The dashed arrow marks Flink's late-record side output.</p>

The producer writes cleaned JSON readings to `traffic-readings`. The analytics module publishes sliding-window results to `traffic-link-stats` and tumbling-window results to `traffic-borough-stats`. The detector publishes incident and sensor-silence alerts to `traffic-incidents`, and Flink sends late readings with `late_by_ms` to `traffic-late-readings`. The borough topic is keyed by `borough`. All other topics use `link_id`.

<div class="page-break"></div>

## 3. Producer and event time

`producer/download_data.py` saves the readings as CSV and decodes road geometry into `data/links.geojson`. The producer drops malformed rows, sensor faults (`status != 0` or `speed <= 0`), and duplicate `(link_id, data_as_of)` pairs. It interprets `data_as_of` in `America/New_York` and converts it to UTC epoch milliseconds in `event_time`.

The producer starts from event-time order. For each reading, it uses the measurement time as the planned release time. With probability 10% it adds a random delay of up to 120 event-time seconds, then sends records in release-time order. The original measurement timestamp stays in the message, and the seed makes the schedule repeatable. The default speedup of **60×** compresses an hour of measurements into one minute of wall time. A speedup of zero sends the data as fast as possible.

### Watermarks and late records

Flink assigns timestamps from `event_time`. Each Kafka partition's watermark trails its largest observed event timestamp by the 120-second out-of-order bound plus one millisecond. This covers the producer's configured 120-second delay, including the boundary. Flink combines watermarks by taking the minimum of active inputs. A partition can be marked idle after 30 seconds of wall time, so it stops holding back the others.

The watermark controls when windows close and when event-time timers can fire. Before either module, `LateReadingFilter` routes readings at or behind the current watermark to `traffic-late-readings`. Setting `FLINK_MAX_OOO_S=30` with the default producer delay lets the watermark advance sooner and can send more readings to this topic. Both offset runs at 120 seconds recorded zero late readings. Flink checkpoints every 10 seconds and writes with at-least-once delivery, so recovery can produce duplicate outputs.

## 4. Windowed analytics

**Road segment.** A **15-minute sliding window** advances every **five minutes**. The 15-minute span usually includes about three readings, so a single unusually high or low reading has less influence on the average. Overlapping windows let consecutive results share recent measurements and keep pace with sensor reports. Each result contains the sample count, mean, minimum, maximum and standard deviation of speed, mean travel time, and congestion level.

**Borough.** We use **five-minute tumbling windows** to compare borough statistics across equal, non-overlapping intervals. Each reading contributes to exactly one interval, so reading counts can be added across intervals without double-counting. Each result contains the reading count, distinct segment count, mean, minimum and maximum speed, and the fraction of readings below 15 mph.

Both branches aggregate incrementally and attach the window bounds when the window fires. The segment branch also keeps a free-flow reference across windows, initialized with the first window mean and updated as the maximum of the current mean and 0.998 times the previous reference. The ratio of mean speed to free-flow speed yields `FREE` at 0.75 or above, `MODERATE` from 0.50, `HEAVY` from 0.30, and `SEVERE` below 0.30.

<div class="page-break"></div>

## 5. Event-driven incident detection

`IncidentDetector` is a Flink `KeyedProcessFunction` with one `ValueState<LinkState>` per segment. The state stores the speed baseline, phase, latest measurement, minimum incident speed, consecutive recovery readings, and both timer deadlines. The first three readings initialize the baseline. Subsequent normal readings update it using an exponentially weighted moving average. The baseline stays fixed during an incident and is relearned after a reporting gap of at least 20 minutes if the segment is in `NORMAL`.

After warm-up, a reading below 50% of baseline triggers `SPEED_DROP` and moves the segment from `NORMAL` to `DROPPED`. The detector schedules a check for 15 minutes after the drop. If the segment is still in `DROPPED` at that point and its latest speed is below 75% of baseline, the detector emits `PERSISTENT_CONGESTION` and moves it to `CONGESTED`.

Two consecutive readings at or above 75% of baseline trigger `RECOVERY`, return the segment to `NORMAL`, and cancel any pending persistence timer. A separate timer emits one `SENSOR_SILENT` alert after 20 minutes without a reading. Each new reading reschedules that timer.

If the next reading for a segment reaches an outstanding deadline before the watermark does, the detector processes that deadline before incorporating the reading. Alerts include the segment, event timestamp, baseline and observed speed, and severity. Incident alerts represent patterns in sensor readings.

## 6. Live dashboard

The Python bridge consumes Kafka, sends a snapshot on connection, and pushes live updates over Socket.IO. The React and MapLibre frontend shows segment congestion, speed histories, active incidents and borough trends. Its timeline reconstructs past views from the bridge's rolling 24-hour event-time history.

![Dashboard showing the NYC road map, timeline, traffic charts and incident feed](img/dashboard.png)

<p class="caption">Figure 2. Dashboard during the replay of 1 October 2026.</p>

<div class="page-break"></div>

## 7. Earliest versus latest offsets

Both runs used fresh topics, four partitions, Flink parallelism of two, and the same seeded sequence of **21,073 input readings**. For `--offset latest`, the job started first and the producer replayed at 600×. For `--offset earliest`, the producer loaded the full day at maximum speed in 0.2 seconds before the job started.

In the paced `latest` run, the first output arrived **1.0 seconds** after the first Kafka input record and the last arrived at **144.0 seconds**. In the `earliest` run, which processed the backlog, the first output came **2.9 seconds** after job submission and the last at **4.4 seconds**. That measurement includes job startup.

Both runs emitted **21,578 segment statistics, 1,435 borough statistics, and 448 alerts**, with zero late readings.

Segment statistics and alert payloads matched. Eight borough averages differed by 0.01 mph because readings from different partitions can be summed in a different floating-point order. Event-time window membership, per-segment input order, and the detector's deadline handling explain the agreement. Both runs emitted 132 speed drops, 86 persistent congestion alerts, 124 recoveries and 106 sensor-silence alerts.

**End of input.** The final reading was measured at **23:58:12 New York time**. Kafka remained an unbounded source and the job stayed running. In both runs the watermark stopped at **23:56:11.999**. With no newer event timestamps, **200 segment windows, 5 borough windows, 71 silence timers and 2 persistence timers** stayed pending. The five borough windows cover 23:55 to midnight, and eight incidents were still open. Idle detection alone cannot advance the watermark. Newer event timestamps allow the pending windows and timers to fire.

## 8. Running and checking the project

Run from the repository root with Docker Compose v2. On first start, Compose downloads the data if the files are missing. The dashboard opens at [localhost:8000](http://localhost:8000) and Flink at [localhost:8081](http://localhost:8081).

```sh
docker compose up -d --build
scripts/consume.sh --counts
scripts/consume.sh traffic-incidents --max-messages 5
```

The [README](../README.md) gives the standalone download, producer and Flink commands for the course Kafka at `localhost:9092`. To reproduce the comparison on a dedicated Compose stack, run `scripts/offset-experiment.sh`. It resets the stack and its volumes between runs and saves `experiment-out/report.md` and the raw topic dumps.

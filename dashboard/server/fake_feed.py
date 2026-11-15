"""Development tool: publishes realistic, contract-shaped messages to Kafka so the
dashboard can be developed without the producer + Flink job running.

It simulates every link from links.geojson on an accelerated event-time clock:
raw readings stream in continuously, and at every 5-minute boundary it emits
sliding-window link stats and tumbling borough stats. A small per-link state
machine produces incident lifecycles (SPEED_DROP -> PERSISTENT_CONGESTION ->
RECOVERY) and SENSOR_SILENT alerts, like the real Flink job.

    uv run python fake_feed.py --prefix test-dash-

By default topics are prefixed with "dev-" so it never writes to the real topics.
"""

import argparse
import asyncio
import json
import random
import statistics
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from aiokafka import AIOKafkaProducer
from aiokafka.admin import AIOKafkaAdminClient, NewTopic
from aiokafka.errors import TopicAlreadyExistsError

MIN = 60_000
STEP = 5 * MIN  # one reading per link per step, like the NYC DOT feed
WINDOW = 15 * MIN  # sliding window size of link stats
NY = ZoneInfo("America/New_York")


def level_of(ratio):
    if ratio >= 0.75:
        return "FREE"
    if ratio >= 0.5:
        return "MODERATE"
    if ratio >= 0.3:
        return "HEAVY"
    return "SEVERE"


def severity_of(ratio, persistent):
    order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    idx = 3 if ratio < 0.2 else 2 if ratio < 0.3 else 1 if ratio < 0.4 else 0
    return order[min(idx + persistent, 3)]


class Link:
    def __init__(self, props, rng):
        self.id = props["link_id"]
        self.name = props["link_name"]
        self.borough = props["borough"]
        self.free_flow = rng.uniform(22, 55)
        self.drift = rng.uniform(0.8, 1.0)  # slow random walk of "normal" traffic
        self.readings = []  # (event_time, speed) of the last window
        self.blockage = None  # (until, depth) while an incident is simulated
        self.silent_until = 0
        self.last_seen = 0
        self.silent_alerted = False
        # incident detector state (mirrors the Flink KeyedProcessFunction)
        self.state = "NORMAL"
        self.incident_start = 0
        self.min_speed = 0.0
        self.above = 0

    def base(self):
        return {"link_id": self.id, "link_name": self.name, "borough": self.borough}


class Simulator:
    def __init__(self, links, args, rng):
        self.links = links
        self.args = args
        self.rng = rng
        self.out = []  # (topic, key, message) waiting to be sent

    def rush_hour(self, t):
        hour = datetime.fromtimestamp(t / 1000, NY).hour
        return 0.72 if hour in (7, 8, 9, 16, 17, 18) else 1.0

    def reading(self, link, t):
        rng = self.rng
        link.drift = min(1.0, max(0.55, link.drift + rng.uniform(-0.04, 0.04)))
        factor = link.drift * self.rush_hour(t)
        if link.blockage and t < link.blockage[0]:
            factor = link.blockage[1]
        elif rng.random() < self.args.incident_rate:
            link.blockage = (t + rng.randint(2, 12) * STEP, rng.uniform(0.12, 0.45))
            factor = link.blockage[1]
        speed = round(max(1.0, link.free_flow * factor * rng.uniform(0.92, 1.08)), 2)
        msg = {**link.base(), "speed_mph": speed, "travel_time_s": int(3600 / speed),
               "data_as_of": datetime.fromtimestamp(t / 1000, NY).strftime("%Y-%m-%dT%H:%M:%S.000"),
               "event_time": t, "sent_at": int(time.time() * 1000), "delayed": False}
        self.out.append(("readings", link.id, msg))
        link.readings.append((t, speed))
        link.last_seen = t
        link.silent_alerted = False
        self.detect(link, t, speed)

    def alert(self, link, kind, t, speed, ratio, text, duration_s=0):
        msg = {**link.base(), "alert_id": f"{link.id}-{t}-{kind}", "type": kind, "event_time": t,
               "incident_start": link.incident_start or t, "duration_s": duration_s,
               "speed_mph": speed, "baseline_mph": round(link.free_flow, 1), "ratio": round(ratio, 3),
               "min_speed_mph": link.min_speed or speed,
               "severity": severity_of(ratio, kind == "PERSISTENT_CONGESTION") if kind != "RECOVERY" else "LOW",
               "message": text}
        self.out.append(("incidents", link.id, msg))

    def detect(self, link, t, speed):
        ff = link.free_flow
        ratio = speed / ff
        if link.state == "NORMAL":
            if ratio < 0.5:
                link.state, link.incident_start, link.min_speed, link.above = "DROPPED", t, speed, 0
                self.alert(link, "SPEED_DROP", t, speed, ratio,
                           f"Speed fell to {speed:.1f} mph ({ratio:.0%} of the usual {ff:.1f} mph)")
            return
        link.min_speed = min(link.min_speed, speed)
        if ratio > 0.75:
            link.above += 1
            if link.above >= 2:
                duration = (t - link.incident_start) // 1000
                self.alert(link, "RECOVERY", t, speed, ratio,
                           f"Back to {speed:.1f} mph after {duration // 60} min", duration)
                link.state, link.incident_start = "NORMAL", 0
            return
        link.above = 0
        if link.state == "DROPPED" and t - link.incident_start >= 15 * MIN and ratio < 0.5:
            link.state = "CONGESTED"
            self.alert(link, "PERSISTENT_CONGESTION", t, speed, ratio,
                       f"Still at {speed:.1f} mph after {(t - link.incident_start) // MIN} min",
                       (t - link.incident_start) // 1000)

    def check_silence(self, link, t):
        if t < link.silent_until:
            if not link.silent_alerted and t - link.last_seen >= 20 * MIN:
                link.silent_alerted = True
                self.alert(link, "SENSOR_SILENT", t, 0.0, 0.0,
                           f"No reading for {(t - link.last_seen) // MIN} min")
            return True
        if self.rng.random() < self.args.silence_rate:
            link.silent_until = t + self.rng.randint(5, 9) * STEP
            return True
        return False

    def window_stats(self, window_end):
        by_borough = {}
        for link in self.links:
            link.readings = [(t, s) for t, s in link.readings if t > window_end - WINDOW]
            speeds = [s for _, s in link.readings]
            if not speeds:
                continue
            avg = statistics.fmean(speeds)
            link.free_flow = max(link.free_flow * 0.999, avg)  # slowly decaying max
            ratio = min(1.0, avg / link.free_flow)
            self.out.append(("link_stats", link.id, {
                **link.base(), "window_start": window_end - WINDOW, "window_end": window_end,
                "count": len(speeds), "avg_speed_mph": round(avg, 2), "min_speed_mph": min(speeds),
                "max_speed_mph": max(speeds), "stddev_speed_mph": round(statistics.pstdev(speeds), 2),
                "avg_travel_time_s": round(3600 / avg, 1), "free_flow_mph": round(link.free_flow, 1),
                "congestion_ratio": round(ratio, 3), "level": level_of(ratio)}))
            last = [s for t, s in link.readings if t > window_end - STEP]
            by_borough.setdefault(link.borough, []).extend(last)
        for borough, speeds in by_borough.items():
            if not speeds:
                continue
            slow = sum(1 for s in speeds if s < 15)
            self.out.append(("borough_stats", borough, {
                "borough": borough, "window_start": window_end - STEP, "window_end": window_end,
                "readings": len(speeds), "links": len(speeds), "avg_speed_mph": round(statistics.fmean(speeds), 2),
                "min_speed_mph": min(speeds), "max_speed_mph": max(speeds),
                "slow_readings": slow, "slow_share": round(slow / len(speeds), 3)}))


async def ensure_topics(bootstrap, names):
    admin = AIOKafkaAdminClient(bootstrap_servers=bootstrap)
    await admin.start()
    try:
        await admin.create_topics([NewTopic(n, num_partitions=4, replication_factor=1) for n in names])
    except TopicAlreadyExistsError:
        pass
    finally:
        await admin.close()


async def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--bootstrap", default="localhost:9092")
    p.add_argument("--prefix", default="dev-", help="prepended to every contract topic name")
    p.add_argument("--links-geojson", type=Path,
                   default=Path(__file__).resolve().parents[2] / "data" / "links.geojson")
    p.add_argument("--speedup", type=float, default=60, help="event time runs this many times faster")
    p.add_argument("--start", default="2026-10-01T06:30:00", help="simulated start, New York time")
    p.add_argument("--incident-rate", type=float, default=0.006, help="chance per reading of a blockage")
    p.add_argument("--silence-rate", type=float, default=0.001, help="chance per step of a sensor going silent")
    p.add_argument("--seed", type=int, default=7)
    args = p.parse_args()

    rng = random.Random(args.seed)
    features = json.loads(args.links_geojson.read_text())["features"]
    sim = Simulator([Link(f["properties"], rng) for f in features], args, rng)
    topics = {k: args.prefix + n for k, n in {
        "readings": "traffic-readings", "link_stats": "traffic-link-stats",
        "borough_stats": "traffic-borough-stats", "incidents": "traffic-incidents"}.items()}
    await ensure_topics(args.bootstrap, list(topics.values()))

    producer = AIOKafkaProducer(bootstrap_servers=args.bootstrap,
                                value_serializer=lambda m: json.dumps(m).encode(),
                                key_serializer=str.encode)
    await producer.start()
    print(f"publishing {len(sim.links)} links to {', '.join(topics.values())} at {args.speedup:g}x")

    t0 = int(datetime.fromisoformat(args.start).replace(tzinfo=NY).timestamp() * 1000)
    step_end = t0 + STEP
    try:
        while True:
            # Each link reports once at a random moment inside the step, in event-time order.
            due = [(step_end - rng.randint(1, STEP - 1), link) for link in sim.links
                   if not sim.check_silence(link, step_end)]
            started, start_t = time.monotonic(), step_end - STEP
            for t, link in sorted(due, key=lambda x: x[0]):
                wait = (t - start_t) / 1000 / args.speedup - (time.monotonic() - started)
                if wait > 0:
                    await asyncio.sleep(wait)
                sim.reading(link, t)
                await flush(producer, topics, sim)
            sim.window_stats(step_end)
            await flush(producer, topics, sim)
            rest = STEP / 1000 / args.speedup - (time.monotonic() - started)
            await asyncio.sleep(max(0.0, rest))
            step_end += STEP
    finally:
        await producer.stop()


async def flush(producer, topics, sim):
    for kind, key, msg in sim.out:
        await producer.send(topics[kind], msg, key=key)
    sim.out.clear()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

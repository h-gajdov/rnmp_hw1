"""Replay NYC traffic readings into Kafka in (simulated) real time, with some records out of order.

Example: python producer.py --input ../data/traffic.csv --speedup 60
Every flag can also be set with an environment variable (shown in --help), which is how the Docker
image is configured.
"""

import argparse
import json
import os
import signal
import sys
import time

from confluent_kafka import KafkaException, Producer
from confluent_kafka.admin import AdminClient, NewTopic

from replay import format_epoch_ms, load_readings, plan_schedule, shift_days, skip_until, parse_local


def env(name, default, cast=str):
    """Default value for a CLI flag: environment variable `name` if set, else `default`."""
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    if cast is bool:
        return value.strip().lower() in ("1", "true", "yes", "on")
    return cast(value)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    a = p.add_argument
    a("--bootstrap", default=env("KAFKA_BOOTSTRAP", "localhost:9092"), help="Kafka bootstrap servers [KAFKA_BOOTSTRAP]")
    a("--topic", default=env("TOPIC", "traffic-readings"), help="output topic [TOPIC]")
    a("--partitions", type=int, default=env("PARTITIONS", 4, int), help="partitions if the topic is created [PARTITIONS]")
    a("--input", default=env("INPUT", "data/traffic.csv"), help="CSV from download_data.py [INPUT]")
    a("--speedup", type=float, default=env("SPEEDUP", 60.0, float),
      help="event-time seconds per wall-clock second; 60 = one hour of data per minute, 0 = no pacing [SPEEDUP]")
    a("--disorder-ratio", type=float, default=env("DISORDER_RATIO", 0.1, float),
      help="fraction of records sent out of order [DISORDER_RATIO]")
    a("--max-delay-s", type=float, default=env("MAX_DELAY_S", 120.0, float),
      help="max event-time delay of an out-of-order record, seconds [MAX_DELAY_S]")
    a("--seed", type=int, default=env("SEED", 42, int), help="random seed, makes the disorder reproducible [SEED]")
    a("--limit", type=int, default=env("LIMIT", 0, int), help="stop after N records, 0 = all [LIMIT]")
    a("--start-at", default=env("START_AT", None), help="skip to this NY time of day, HH:MM[:SS] [START_AT]")
    a("--loop", action="store_true", default=env("LOOP", False, bool),
      help="replay forever, shifting the data one day later each round [LOOP]")
    a("--progress-s", type=float, default=env("PROGRESS_S", 5.0, float), help="seconds between progress lines [PROGRESS_S]")
    a("--kafka-wait-s", type=float, default=env("KAFKA_WAIT_S", 120.0, float),
      help="how long to wait for Kafka at startup [KAFKA_WAIT_S]")
    return p.parse_args(argv)


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- Kafka setup

def wait_for_kafka(admin: AdminClient, timeout_s: float):
    """Retry until the broker answers, so the container may start before Kafka is ready."""
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            return admin.list_topics(timeout=5)
        except KafkaException as e:
            if time.monotonic() > deadline:
                raise SystemExit(f"Kafka not reachable after {timeout_s:.0f}s: {e}")
            log(f"waiting for Kafka ... ({e})")
            time.sleep(2)


def ensure_topic(admin: AdminClient, topic: str, partitions: int, timeout_s: float):
    metadata = wait_for_kafka(admin, timeout_s)
    if topic in metadata.topics:
        log(f"topic {topic} exists ({len(metadata.topics[topic].partitions)} partitions)")
        return
    future = admin.create_topics([NewTopic(topic, num_partitions=partitions, replication_factor=1)])[topic]
    try:
        future.result()
        log(f"created topic {topic} with {partitions} partitions")
    except KafkaException as e:
        # Another process may have created it in the meantime.
        if "TOPIC_ALREADY_EXISTS" not in str(e):
            raise


# ---------------------------------------------------------------- replay loop

class Stats:
    def __init__(self):
        self.sent = 0
        self.delayed = 0
        self.failed = 0
        self.started = time.monotonic()
        self.last_report = self.started
        self.event_time = None

    def report(self, final=False):
        elapsed = max(time.monotonic() - self.started, 1e-9)
        share = 100.0 * self.delayed / self.sent if self.sent else 0.0
        when = format_epoch_ms(self.event_time) if self.event_time else "-"
        prefix = "done" if final else "progress"
        log(f"[{prefix}] event time {when} | sent {self.sent} | delayed {self.delayed} ({share:.1f}%)"
            f" | failed {self.failed} | {self.sent / elapsed:.1f} msg/s")
        self.last_report = time.monotonic()


def rounds(readings, args):
    """Yield the schedule for each replay round (one round unless --loop)."""
    first = skip_until(readings, args.start_at) if args.start_at else readings
    days = (parse_local(readings[-1].data_as_of).date() - parse_local(readings[0].data_as_of).date()).days + 1
    max_delay_ms = int(args.max_delay_s * 1000)
    n = 0
    while True:
        batch = first if n == 0 else shift_days(readings, n * days)
        yield plan_schedule(batch, args.disorder_ratio, max_delay_ms, seed=args.seed + n)
        n += 1
        if not args.loop:
            return


def replay(producer: Producer, readings, args, stats: Stats):
    def on_delivery(err, _msg):
        if err is not None:
            stats.failed += 1

    wall_start = None    # wall clock (monotonic) at the first record
    replay_start = None  # release time of the first record
    for schedule in rounds(readings, args):
        for item in schedule:
            if args.limit and stats.sent >= args.limit:
                return
            if wall_start is None:
                wall_start, replay_start = time.monotonic(), item.release_time

            # Simulated real time: wait until this record's release time, scaled by --speedup.
            # Records with the same timestamp have the same target, so they go out together.
            if args.speedup > 0:
                target = wall_start + (item.release_time - replay_start) / 1000.0 / args.speedup
                while (remaining := target - time.monotonic()) > 0:
                    producer.poll(min(remaining, 0.2))  # serve delivery callbacks while waiting
                    if time.monotonic() - stats.last_report >= args.progress_s:
                        stats.report()

            r = item.reading
            value = r.to_message(sent_at=int(time.time() * 1000), delayed=item.delayed)
            while True:
                try:
                    producer.produce(args.topic, key=r.link_id, value=json.dumps(value), on_delivery=on_delivery)
                    break
                except BufferError:  # local queue full: let it drain
                    producer.poll(0.5)
            producer.poll(0)

            stats.sent += 1
            stats.delayed += item.delayed
            stats.event_time = r.event_time
            if time.monotonic() - stats.last_report >= args.progress_s:
                stats.report()


def on_sigterm(_signum, _frame):
    """Turn `docker stop` (SIGTERM) into the same clean shutdown as Ctrl+C."""
    raise KeyboardInterrupt


def main(argv=None):
    args = parse_args(argv)

    signal.signal(signal.SIGTERM, on_sigterm)

    readings, load = load_readings(args.input)
    log(f"loaded {args.input}: {load.total} rows, dropped {load.faulty} faulty (status != 0 or speed <= 0),"
        f" {load.duplicates} duplicates, {load.malformed} malformed -> {load.kept} readings")
    if not readings:
        raise SystemExit("nothing to send")
    log(f"event time {format_epoch_ms(readings[0].event_time)} .. {format_epoch_ms(readings[-1].event_time)}"
        f" (America/New_York), speedup {args.speedup:g}, disorder {args.disorder_ratio:g}"
        f" up to {args.max_delay_s:g}s, seed {args.seed}")

    ensure_topic(AdminClient({"bootstrap.servers": args.bootstrap}), args.topic, args.partitions, args.kafka_wait_s)
    producer = Producer({"bootstrap.servers": args.bootstrap, "linger.ms": 20, "acks": "all"})

    stats = Stats()
    try:
        replay(producer, readings, args, stats)
    except KeyboardInterrupt:
        log("interrupted, flushing ...")
    finally:
        remaining = producer.flush(10)
        stats.report(final=True)
        if remaining:
            log(f"WARNING: {remaining} messages were not delivered")


if __name__ == "__main__":
    main()

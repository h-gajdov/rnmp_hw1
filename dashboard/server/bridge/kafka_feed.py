"""Consumes the Flink output topics and pushes every message to the browsers.

There is no batching: each Kafka record is applied to the shared state and
emitted over Socket.IO as soon as it is read, so the page lags Flink by
milliseconds.
"""

import asyncio
import json
import logging
import re

from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaError

log = logging.getLogger("bridge.kafka")

def compact_reading(msg):
    """The browser only needs a few fields of a raw reading."""
    return {"link_id": msg["link_id"], "speed_mph": msg["speed_mph"], "event_time": msg["event_time"]}


async def start_consumer(config):
    """Create a consumer, retrying until the broker is reachable."""
    delay = 1
    while True:
        consumer = AIOKafkaConsumer(
            bootstrap_servers=config.bootstrap,
            group_id=None,  # every bridge reads all partitions, no committed offsets
            auto_offset_reset=config.offset,
            metadata_max_age_ms=5000,  # notice topics that are created after we start
        )
        # A pattern only matches topics that exist, so the bridge never auto-creates
        # a topic (with the wrong partition count) and picks it up once Flink creates it.
        consumer.subscribe(pattern="^(" + "|".join(re.escape(t) for t in config.topics) + ")$")
        try:
            await consumer.start()
            log.info("connected to Kafka at %s, topics: %s", config.bootstrap, ", ".join(config.topics))
            return consumer
        except KafkaError as e:
            await consumer.stop()
            log.warning("Kafka at %s not reachable (%s), retrying in %ss", config.bootstrap, e, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10)


async def run_kafka_feed(config, timeline, sio):
    """Read forever: update the state and the history, then push the message to every client."""
    topics = config.topics
    consumer = await start_consumer(config)
    try:
        async for record in consumer:
            kind = topics[record.topic]
            try:
                msg = json.loads(record.value)
                if not timeline.apply(kind, msg):
                    continue  # duplicate alert, already shown
            except (ValueError, KeyError, TypeError) as e:
                log.warning("skipping malformed message on %s: %s", record.topic, e)
                continue
            payload = compact_reading(msg) if kind in ("reading", "late_reading") else msg
            await sio.emit(kind, payload)
    finally:
        await consumer.stop()


async def run_forever(config, timeline, sio):
    """Keep the feed alive: if the consumer crashes, log it and start a new one."""
    while True:
        try:
            await run_kafka_feed(config, timeline, sio)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Kafka feed crashed, restarting in 3 s")
            await asyncio.sleep(3)

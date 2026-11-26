"""Pure replay logic (no Kafka): load and clean readings, convert times, plan the out-of-order schedule.

Kept separate from producer.py so it can be unit tested without a broker.
"""

import csv
import random
from dataclasses import dataclass, replace
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class Reading:
    link_id: str
    link_name: str
    borough: str
    speed_mph: float
    travel_time_s: int
    data_as_of: str   # original NY local time string, e.g. "2026-10-01T00:28:10.000"
    event_time: int   # epoch milliseconds (UTC)

    def to_message(self, sent_at: int, delayed: bool) -> dict:
        """The `traffic-readings` JSON value from docs/CONTRACT.md."""
        return {
            "link_id": self.link_id,
            "link_name": self.link_name,
            "borough": self.borough,
            "speed_mph": self.speed_mph,
            "travel_time_s": self.travel_time_s,
            "data_as_of": self.data_as_of,
            "event_time": self.event_time,
            "sent_at": sent_at,
            "delayed": delayed,
        }


# ---------------------------------------------------------------- time conversion

def parse_local(data_as_of: str) -> datetime:
    """'2026-10-01T00:28:10.000' (New York wall-clock time, no offset) -> aware datetime."""
    return datetime.fromisoformat(data_as_of).replace(tzinfo=NY)


def to_epoch_ms(data_as_of: str) -> int:
    return int(parse_local(data_as_of).timestamp() * 1000)


def format_local(dt: datetime) -> str:
    """Inverse of parse_local, same format as the dataset (millisecond precision)."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}"


def format_epoch_ms(ms: int) -> str:
    """Human-readable NY local time for log lines."""
    return datetime.fromtimestamp(ms / 1000, NY).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- loading and cleaning

@dataclass
class LoadStats:
    total: int = 0
    malformed: int = 0
    faulty: int = 0       # status != 0 or speed <= 0
    duplicates: int = 0   # same (link_id, data_as_of) seen before
    kept: int = 0


def parse_row(row: dict):
    """CSV row -> Reading, or None if the row is a sensor fault. Raises ValueError if malformed."""
    status = int(float(row["status"]))
    speed = float(row["speed"])
    if status != 0 or speed <= 0:
        return None
    return Reading(
        link_id=row["link_id"].strip(),
        link_name=row["link_name"].strip(),
        borough=row["borough"].strip(),
        speed_mph=speed,
        travel_time_s=int(float(row["travel_time"])),
        data_as_of=row["data_as_of"].strip(),
        event_time=to_epoch_ms(row["data_as_of"].strip()),
    )


def clean_rows(rows) -> tuple:
    """Drop malformed rows, sensor faults and duplicates; return (readings sorted by event time, stats)."""
    stats = LoadStats()
    seen = set()
    readings = []
    for row in rows:
        stats.total += 1
        try:
            reading = parse_row(row)
        except (KeyError, ValueError, TypeError):
            stats.malformed += 1
            continue
        if reading is None:
            stats.faulty += 1
            continue
        key = (reading.link_id, reading.data_as_of)
        if key in seen:
            stats.duplicates += 1
            continue
        seen.add(key)
        readings.append(reading)
    readings.sort(key=lambda r: (r.event_time, r.link_id))
    stats.kept = len(readings)
    return readings, stats


def load_readings(path: str) -> tuple:
    with open(path, newline="") as f:
        return clean_rows(csv.DictReader(f))


def skip_until(readings: list, start_at: str) -> list:
    """Keep readings whose NY time of day is >= start_at ('HH:MM' or 'HH:MM:SS') on the first day."""
    first_day = parse_local(readings[0].data_as_of).date() if readings else None
    cutoff = datetime.combine(first_day, time.fromisoformat(start_at), NY) if first_day else None
    return [r for r in readings if parse_local(r.data_as_of) >= cutoff]


def shift_days(readings: list, days: int) -> list:
    """Copy of the readings moved `days` days later (used by --loop so event time keeps increasing)."""
    if days == 0:
        return readings
    out = []
    for r in readings:
        local = parse_local(r.data_as_of) + timedelta(days=days)
        text = format_local(local)
        out.append(replace(r, data_as_of=text, event_time=to_epoch_ms(text)))
    return out


# ---------------------------------------------------------------- disorder scheduler

@dataclass(frozen=True)
class Scheduled:
    reading: Reading
    release_time: int  # event-time instant at which the producer sends the record
    delayed: bool


def plan_schedule(readings: list, disorder_ratio: float, max_delay_ms: int, seed=None) -> list:
    """Decide the order in which records are sent.

    Every record is normally released at its own event time. A random `disorder_ratio` fraction is
    held back: its release time becomes event_time + d with d uniform in (0, max_delay_ms]. Sorting by
    release time then puts such a record after records that happened later, i.e. out of order.

    The replay clock follows release times, so a record is never more than `max_delay_ms` of event
    time behind the newest record sent before it. A Flink watermark with bounded out-of-orderness
    >= max_delay therefore never marks these records as late.
    """
    rng = random.Random(seed)
    planned = []
    for r in readings:
        if max_delay_ms > 0 and rng.random() < disorder_ratio:
            delay = rng.randint(1, max_delay_ms)
            planned.append(Scheduled(r, r.event_time + delay, True))
        else:
            planned.append(Scheduled(r, r.event_time, False))
    # sort() is stable: ties keep the original (event-time) order.
    planned.sort(key=lambda s: s.release_time)
    return planned


# ---------------------------------------------------------------- resuming

def resume_round(first_day, days: int, newest_ms: int) -> int:
    """The replay round (0 = the data as it is, n = shifted n * days later) that contains `newest_ms`,
    the newest event time already in the topic. Data older than the CSV gives round 0."""
    newest_day = datetime.fromtimestamp(newest_ms / 1000, NY).date()
    return max(0, (newest_day - first_day).days // days)


def unsent(schedule: list, newest_ms: int, sent: set) -> list:
    """The part of a round's schedule that a previous run has not sent yet.

    Everything released up to `newest_ms` went out before the newest record in the topic did. A held-back
    record released after it may also be out already: `sent` holds the (link_id, event_time) pairs read
    from the end of the topic, so such a record is not sent twice.
    """
    return [s for s in schedule
            if s.release_time > newest_ms and (s.reading.link_id, s.reading.event_time) not in sent]

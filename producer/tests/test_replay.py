import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from replay import Reading, clean_rows, days_after, plan_schedule, shift_days, skip_until, to_epoch_ms  # noqa: E402


def row(link_id="4616253", speed="42.25", status="0", data_as_of="2026-10-01T00:28:10.000", travel_time="60"):
    return {"link_id": link_id, "link_name": "CBE E TAYLOR AVENUE - CASTLE HILL AVENUE", "borough": "Bronx",
            "speed": speed, "travel_time": travel_time, "status": status, "data_as_of": data_as_of}


def reading(event_time, link_id="1"):
    return Reading(link_id, "name", "Bronx", 30.0, 60, "2026-10-01T00:00:00.000", event_time)


# ---------------------------------------------------------------- time conversion

def test_event_time_matches_contract_example():
    assert to_epoch_ms("2026-10-01T00:28:10.000") == 1790828890000


def test_event_time_uses_new_york_offset():
    # EDT (UTC-4) in October, EST (UTC-5) in December.
    assert to_epoch_ms("2026-10-01T12:00:00.000") == 1790870400000  # 16:00 UTC
    assert to_epoch_ms("2026-12-01T12:00:00.000") == 1796144400000  # 17:00 UTC


# ---------------------------------------------------------------- cleaning

def test_clean_rows_drops_faults_duplicates_and_malformed():
    rows = [
        row(),
        row(),                                   # duplicate (link_id, data_as_of)
        row(link_id="2", status="-101"),         # sensor fault
        row(link_id="3", speed="0"),             # speed <= 0
        row(link_id="4", speed="abc"),           # malformed
        row(link_id="5", data_as_of="2026-10-01T00:20:00.000"),
    ]
    readings, stats = clean_rows(rows)
    assert (stats.total, stats.duplicates, stats.faulty, stats.malformed, stats.kept) == (6, 1, 2, 1, 2)
    assert [r.link_id for r in readings] == ["5", "4616253"]  # sorted by event time


def test_message_has_contract_fields():
    readings, _ = clean_rows([row()])
    msg = readings[0].to_message(sent_at=123, delayed=True)
    assert msg == {
        "link_id": "4616253", "link_name": "CBE E TAYLOR AVENUE - CASTLE HILL AVENUE", "borough": "Bronx",
        "speed_mph": 42.25, "travel_time_s": 60, "data_as_of": "2026-10-01T00:28:10.000",
        "event_time": 1790828890000, "sent_at": 123, "delayed": True,
    }


def test_skip_until_and_shift_days():
    readings, _ = clean_rows([row(data_as_of="2026-10-01T07:59:00.000", link_id="a"),
                              row(data_as_of="2026-10-01T08:00:00.000", link_id="b")])
    assert [r.link_id for r in skip_until(readings, "08:00")] == ["b"]
    shifted = shift_days(readings, 1)
    assert shifted[0].data_as_of == "2026-10-02T07:59:00.000"
    assert shifted[0].event_time - readings[0].event_time == 86_400_000


def test_days_after_continues_on_the_next_free_day():
    readings, _ = clean_rows([row(data_as_of="2026-10-01T00:00:06.000"), row(data_as_of="2026-10-01T23:58:12.000")])
    assert days_after(readings, None) == 0  # empty topic
    assert days_after(readings, readings[0].event_time - 1) == 0  # topic is older
    assert days_after(readings, readings[-1].event_time) == 1  # the same day is already there
    stopped_early = to_epoch_ms("2026-10-01T14:00:00.000")
    assert days_after(readings, stopped_early) == 1
    two_runs = to_epoch_ms("2026-10-02T23:58:12.000")
    assert days_after(readings, two_runs) == 2
    # the first reading of the shifted replay is after everything in the topic
    assert shift_days(readings, days_after(readings, two_runs))[0].event_time > two_runs


# ---------------------------------------------------------------- disorder scheduler

READINGS = [reading(t * 1000, link_id=str(t % 7)) for t in range(0, 20_000, 3)]  # one every 3 s


def test_no_disorder_keeps_event_time_order():
    plan = plan_schedule(READINGS, disorder_ratio=0.0, max_delay_ms=120_000, seed=1)
    assert [s.reading for s in plan] == READINGS
    assert not any(s.delayed for s in plan)


def test_delay_bounds_and_out_of_order():
    max_delay = 120_000
    plan = plan_schedule(READINGS, disorder_ratio=0.3, max_delay_ms=max_delay, seed=7)
    assert sorted(s.reading.event_time for s in plan) == [r.event_time for r in READINGS]  # nothing lost
    for s in plan:
        delay = s.release_time - s.reading.event_time
        assert (0 < delay <= max_delay) if s.delayed else delay == 0
    # Release times are non-decreasing, and some records really are out of order.
    assert all(a.release_time <= b.release_time for a, b in zip(plan, plan[1:]))
    events = [s.reading.event_time for s in plan]
    assert any(a > b for a, b in zip(events, events[1:]))


def test_out_of_orderness_never_exceeds_max_delay():
    """What a Flink watermark with bound = max_delay relies on."""
    max_delay = 120_000
    plan = plan_schedule(READINGS, disorder_ratio=0.5, max_delay_ms=max_delay, seed=3)
    max_seen = 0
    for s in plan:
        max_seen = max(max_seen, s.reading.event_time)
        assert max_seen - s.reading.event_time <= max_delay


@pytest.mark.parametrize("ratio", [0.05, 0.1, 0.5])
def test_ratio_is_respected(ratio):
    plan = plan_schedule(READINGS, disorder_ratio=ratio, max_delay_ms=120_000, seed=11)
    share = sum(s.delayed for s in plan) / len(plan)
    assert share == pytest.approx(ratio, abs=0.03)


def test_seed_makes_schedule_deterministic():
    a = plan_schedule(READINGS, 0.2, 120_000, seed=5)
    b = plan_schedule(READINGS, 0.2, 120_000, seed=5)
    c = plan_schedule(READINGS, 0.2, 120_000, seed=6)
    assert a == b
    assert a != c

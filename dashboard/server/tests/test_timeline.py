import json

import pytest
from test_state import borough, incident, link_stats

from bridge.timeline import Timeline

MIN = 60_000


def test_state_at_shows_the_past_and_live_is_unchanged():
    tl = Timeline()
    tl.apply("link_stats", link_stats(window_end=10 * MIN, speed=50))
    tl.apply("incident", incident("SPEED_DROP", t=12 * MIN))
    tl.apply("link_stats", link_stats(window_end=15 * MIN, speed=10))
    tl.apply("incident", incident("RECOVERY", t=25 * MIN))
    tl.apply("link_stats", link_stats(window_end=30 * MIN, speed=45))

    past = tl.state_at(14 * MIN)
    assert past.links["1"]["avg_speed_mph"] == 50
    assert "1" in past.active_incidents
    assert past.incident_counts["SPEED_DROP"] == 1 and past.incident_counts["RECOVERY"] == 0
    assert [p["window_end"] for p in past.link_history["1"]] == [10 * MIN]
    assert past.event_clock == 14 * MIN

    assert tl.live.links["1"]["avg_speed_mph"] == 45
    assert "1" not in tl.live.active_incidents
    assert tl.live.event_clock == 30 * MIN


def test_state_at_counts_readings_and_clamps_the_clock_to_the_stream():
    tl = Timeline()
    for t in (1, 2, 3):
        tl.apply("reading", {"link_id": "1", "speed_mph": 30, "event_time": t * MIN})
    tl.apply("late_reading", {"link_id": "1", "speed_mph": 30, "event_time": 1 * MIN, "late_by_ms": 5})
    assert tl.state_at(2 * MIN).readings_total == 2
    assert tl.state_at(2 * MIN).late_total == 1
    assert tl.state_at(99 * MIN).event_clock == 3 * MIN  # cannot travel past the stream
    assert tl.state_at(0).links == {}


def test_late_window_is_replayed_by_its_event_time():
    tl = Timeline()
    tl.apply("link_stats", link_stats(window_end=20 * MIN, speed=20))
    tl.apply("link_stats", link_stats(window_end=10 * MIN, speed=40))  # arrives late
    assert tl.state_at(15 * MIN).links["1"]["avg_speed_mph"] == 40
    assert tl.state_at(20 * MIN).links["1"]["avg_speed_mph"] == 20


def test_log_keeps_only_the_configured_span():
    tl = Timeline(keep_ms=60 * MIN)
    for i in range(1, 25):  # two hours of 5-minute windows
        tl.apply("link_stats", link_stats(window_end=i * 5 * MIN))
    assert tl.start == 60 * MIN
    assert tl.live.links["1"]["window_end"] == 120 * MIN


def test_summary_combines_boroughs_weighted_by_readings():
    tl = Timeline()
    tl.apply("borough_stats", borough(0, name="Queens", speed=20))
    tl.apply("borough_stats", borough(0, name="Bronx", speed=40))
    tl.apply("borough_stats", borough(300_000, name="Queens", speed=30))
    tl.apply("borough_stats", borough(300_000, name="Queens", speed=35))  # repeated window replaces
    summary = json.loads(json.dumps(tl.summary()))
    assert summary["start"] == 300_000 and summary["end"] == 600_000
    assert [p["avg_speed_mph"] for p in summary["series"]] == [30, 35]


def test_malformed_message_is_not_logged():
    tl = Timeline()
    with pytest.raises(KeyError):
        tl.apply("link_stats", {"link_id": "1"})
    assert not tl.log


def test_duplicate_alert_is_not_logged_or_pushed():
    tl = Timeline()
    assert tl.apply("incident", incident("SPEED_DROP", t=MIN))
    assert not tl.apply("incident", incident("SPEED_DROP", t=MIN))
    assert len(tl.log) == 1
    assert tl.state_at(2 * MIN).incident_counts["SPEED_DROP"] == 1

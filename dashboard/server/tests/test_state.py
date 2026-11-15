import json

from bridge.state import DashboardState


def link_stats(link_id="1", window_end=900_000, speed=30.0, ratio=0.7):
    return {
        "link_id": link_id, "link_name": "A - B", "borough": "Bronx",
        "window_start": window_end - 900_000, "window_end": window_end, "count": 3,
        "avg_speed_mph": speed, "min_speed_mph": speed, "max_speed_mph": speed,
        "stddev_speed_mph": 0.0, "avg_travel_time_s": 60.0, "free_flow_mph": 44.0,
        "congestion_ratio": ratio, "level": "MODERATE",
    }


def incident(kind, link_id="1", t=1_000_000):
    return {"alert_id": f"{link_id}-{t}-{kind}", "type": kind, "link_id": link_id,
            "link_name": "A - B", "borough": "Bronx", "event_time": t, "incident_start": t}


def borough(window_start, name="Queens", speed=25.0):
    return {"borough": name, "window_start": window_start, "window_end": window_start + 300_000,
            "readings": 10, "links": 8, "avg_speed_mph": speed, "min_speed_mph": 5.0,
            "max_speed_mph": 50.0, "slow_readings": 2, "slow_share": 0.2}


def test_latest_link_stats_win_and_late_window_is_ignored():
    s = DashboardState()
    s.apply_link_stats(link_stats(window_end=1_800_000, speed=20))
    s.apply_link_stats(link_stats(window_end=900_000, speed=40))  # older window arrives late
    assert s.links["1"]["avg_speed_mph"] == 20
    assert [p["window_end"] for p in s.link_history["1"]] == [1_800_000]
    assert s.event_clock == 1_800_000


def test_link_history_is_bounded():
    s = DashboardState(link_history=3)
    for i in range(1, 6):
        s.apply_link_stats(link_stats(window_end=i * 300_000))
    assert [p["window_end"] for p in s.link_history["1"]] == [900_000, 1_200_000, 1_500_000]


def test_incident_lifecycle_opens_updates_and_closes():
    s = DashboardState()
    s.apply_incident(incident("SPEED_DROP", t=1_000))
    assert s.active_incidents["1"]["type"] == "SPEED_DROP"
    s.apply_incident(incident("PERSISTENT_CONGESTION", t=2_000))
    assert s.active_incidents["1"]["type"] == "PERSISTENT_CONGESTION"
    s.apply_incident(incident("RECOVERY", t=3_000))
    assert "1" not in s.active_incidents
    snap = s.snapshot()
    assert snap["incident_counts"] == {
        "SPEED_DROP": 1, "PERSISTENT_CONGESTION": 1, "RECOVERY": 1, "SENSOR_SILENT": 0}
    assert [i["type"] for i in snap["recent_incidents"]] == ["RECOVERY", "PERSISTENT_CONGESTION", "SPEED_DROP"]


def test_silent_link_clears_when_new_window_arrives():
    s = DashboardState()
    s.apply_incident(incident("SENSOR_SILENT", t=1_000_000))
    assert "1" in s.silent_links
    s.apply_link_stats(link_stats(window_end=900_000))  # older data does not clear it
    assert "1" in s.silent_links
    s.apply_link_stats(link_stats(window_end=1_200_000))
    assert "1" not in s.silent_links


def test_borough_series_dedupes_windows_and_keeps_newest():
    s = DashboardState(borough_history=2)
    s.apply_borough_stats(borough(0, speed=10))
    s.apply_borough_stats(borough(0, speed=12))  # same window again replaces it
    s.apply_borough_stats(borough(300_000))
    s.apply_borough_stats(borough(600_000))
    series = s.snapshot()["boroughs"]["Queens"]
    assert [w["window_start"] for w in series] == [300_000, 600_000]


def test_counters_and_snapshot_is_json_serialisable():
    s = DashboardState()
    s.apply_reading({"link_id": "1", "speed_mph": 30, "event_time": 5})
    s.apply_late_reading({"link_id": "1", "speed_mph": 30, "event_time": 1, "late_by_ms": 4})
    s.apply_link_stats(link_stats())
    s.apply_borough_stats(borough(0))
    s.apply_incident(incident("SPEED_DROP"))
    snap = json.loads(json.dumps(s.snapshot()))
    assert snap["readings_total"] == 1 and snap["late_total"] == 1
    assert len(snap["active_incidents"]) == 1

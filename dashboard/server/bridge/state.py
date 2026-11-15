"""In-memory picture of "what the stream looks like right now".

The bridge feeds every Kafka message into a DashboardState. When a browser
connects it receives `snapshot()`, so a freshly opened page is populated
immediately instead of waiting for the next Flink window.

This module is pure Python (no Kafka, no sockets), which keeps it easy to test.
"""

from collections import Counter, deque

INCIDENT_TYPES = ("SPEED_DROP", "PERSISTENT_CONGESTION", "RECOVERY", "SENSOR_SILENT")


class DashboardState:
    def __init__(self, link_history=24, borough_history=48, recent_incidents=60):
        self.link_history_size = link_history
        self.borough_history_size = borough_history

        self.links = {}  # link_id -> latest traffic-link-stats message
        self.link_history = {}  # link_id -> deque of compact recent windows
        self.boroughs = {}  # borough -> {window_start: compact window}
        self.active_incidents = {}  # link_id -> latest open-incident alert
        self.silent_links = {}  # link_id -> SENSOR_SILENT alert
        self.recent_incidents = deque(maxlen=recent_incidents)
        self.incident_counts = Counter()
        self.seen_alerts = set()  # alert ids already applied (the Flink sinks are at-least-once)
        self.readings_total = 0
        self.late_total = 0
        self.event_clock = 0  # highest event time seen on any topic (ms)

    # ---- topic handlers -------------------------------------------------

    def apply_link_stats(self, msg):
        link_id = str(msg["link_id"])
        current = self.links.get(link_id)
        # A late, older window must not overwrite the newer state of the link.
        if current is None or msg["window_end"] >= current["window_end"]:
            self.links[link_id] = msg

        history = self.link_history.setdefault(link_id, deque(maxlen=self.link_history_size))
        point = {
            "window_end": msg["window_end"],
            "avg_speed_mph": msg["avg_speed_mph"],
            "congestion_ratio": msg["congestion_ratio"],
        }
        if not history or point["window_end"] > history[-1]["window_end"]:
            history.append(point)

        # Fresh data means the sensor is talking again.
        silent = self.silent_links.get(link_id)
        if silent and msg["window_end"] > silent["event_time"]:
            del self.silent_links[link_id]

        self._advance_clock(msg["window_end"])

    def apply_borough_stats(self, msg):
        series = self.boroughs.setdefault(msg["borough"], {})
        series[msg["window_start"]] = {
            "window_start": msg["window_start"],
            "window_end": msg["window_end"],
            "avg_speed_mph": msg["avg_speed_mph"],
            "slow_share": msg["slow_share"],
            "readings": msg["readings"],
            "links": msg["links"],
        }
        # Keep only the newest N windows.
        for old in sorted(series)[: -self.borough_history_size]:
            del series[old]
        self._advance_clock(msg["window_end"])

    def apply_incident(self, msg):
        """Returns False for an alert that was already applied (same alert_id): a
        redelivery or the same day replayed again, which must not be counted twice."""
        if msg["alert_id"] in self.seen_alerts:
            return False
        self.seen_alerts.add(msg["alert_id"])
        link_id = str(msg["link_id"])
        kind = msg["type"]
        self.incident_counts[kind] += 1
        self.recent_incidents.appendleft(msg)

        if kind in ("SPEED_DROP", "PERSISTENT_CONGESTION"):
            self.active_incidents[link_id] = msg
        elif kind == "RECOVERY":
            self.active_incidents.pop(link_id, None)
        elif kind == "SENSOR_SILENT":
            self.silent_links[link_id] = msg

        self._advance_clock(msg["event_time"])
        return True

    def apply_reading(self, msg):
        self.readings_total += 1
        self._advance_clock(msg["event_time"])

    def apply_late_reading(self, msg):
        self.late_total += 1

    def _advance_clock(self, event_time):
        if event_time and event_time > self.event_clock:
            self.event_clock = event_time

    # ---- snapshot -------------------------------------------------------

    def snapshot(self):
        """Everything a new browser needs, as plain JSON-serialisable data."""
        return {
            "event_clock": self.event_clock,
            "links": self.links,
            "link_history": {k: list(v) for k, v in self.link_history.items()},
            "boroughs": {b: [s[k] for k in sorted(s)] for b, s in self.boroughs.items()},
            "active_incidents": list(self.active_incidents.values()),
            "silent_links": list(self.silent_links.values()),
            "recent_incidents": list(self.recent_incidents),
            "incident_counts": {t: self.incident_counts[t] for t in INCIDENT_TYPES},
            "readings_total": self.readings_total,
            "late_total": self.late_total,
        }

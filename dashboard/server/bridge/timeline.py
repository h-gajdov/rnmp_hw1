"""The live state plus a log of every message, so the dashboard can travel back in time.

`Timeline.apply()` updates the live DashboardState and appends the message to a log.
`state_at(t)` rebuilds the picture as it was at event time `t` by replaying the logged
messages whose event time is <= t, in event-time order, into a fresh DashboardState, so
the past view uses exactly the same rules as the live one. One day is ~45k messages
(link windows, borough windows, incidents, readings) and replays in tens of milliseconds;
`frozen()` takes a cheap copy of the log so the bridge can replay in a worker thread
while the Kafka feed keeps updating the live state.

The log keeps the last `keep_ms` of event time (default one day); older messages are
dropped as the stream advances, so a looping producer does not grow memory forever.
This module is pure Python, like state.py.
"""

from collections import deque

from .state import DashboardState

DAY_MS = 24 * 60 * 60 * 1000
WINDOWED = ("link_stats", "borough_stats")

APPLY = {
    "link_stats": "apply_link_stats",
    "borough_stats": "apply_borough_stats",
    "incident": "apply_incident",
    "reading": "apply_reading",
    "late_reading": "apply_late_reading",
}


def event_time_of(kind, msg):
    """When a message 'happened': the end of its window, or its event time."""
    return msg["window_end"] if kind in WINDOWED else msg["event_time"]


class Timeline:
    def __init__(self, keep_ms=DAY_MS, **state_options):
        self.keep_ms = keep_ms
        self.state_options = state_options
        self.live = DashboardState(**state_options)
        self.log = deque()  # (event_time, kind, msg) in arrival order
        self.newest = 0

    def apply(self, kind, msg):
        """Update the live state and remember the message. Returns False for a duplicate
        alert (nothing changed, nothing to push). Raises on a malformed message."""
        if getattr(self.live, APPLY[kind])(msg) is False:
            return False
        t = event_time_of(kind, msg)
        if kind in ("reading", "late_reading"):
            msg = {"event_time": t}  # replay only needs the time, keep the log small
        self.log.append((t, kind, msg))
        self._prune(t)
        return True

    def _prune(self, t):
        if t <= self.newest:
            return
        self.newest = t
        cutoff = t - self.keep_ms
        # The log is in arrival order, which is close to event-time order: drop from
        # the front while it is old. A rare late straggler further in is harmless.
        while self.log and self.log[0][0] < cutoff:
            self.log.popleft()

    @property
    def start(self):
        """Earliest event time the log can show (0 when empty)."""
        return min((t for t, _, _ in self.log), default=0)

    def frozen(self):
        """A copy of the log and the clock, safe to replay in another thread
        (the messages themselves are never modified, so they are shared)."""
        return FrozenLog(list(self.log), self.live.event_clock, self.state_options)

    def state_at(self, at):
        """The dashboard state as it was at event time `at` (ms)."""
        return self.frozen().state_at(at)

    def network_series(self):
        """Network speed and slow share per 5-minute window over the whole log, for
        the time bar: borough windows combined, weighted by their readings."""
        windows = {}
        for _, kind, msg in self.log:
            if kind == "borough_stats":
                # A repeated borough window replaces the earlier one, like in the state.
                windows.setdefault(msg["window_start"], {})[msg["borough"]] = msg
        series = []
        for start in sorted(windows):
            parts = windows[start].values()
            readings = sum(p["readings"] for p in parts)
            if not readings:
                continue
            series.append({
                "window_end": max(p["window_end"] for p in parts),
                "avg_speed_mph": round(sum(p["avg_speed_mph"] * p["readings"] for p in parts) / readings, 2),
                "slow_share": round(sum(p["slow_share"] * p["readings"] for p in parts) / readings, 4),
            })
        return series

    def summary(self):
        """The range the time bar can travel over and the network series to draw on it."""
        return {"start": self.start, "end": self.live.event_clock, "series": self.network_series()}


class FrozenLog:
    def __init__(self, entries, clock, state_options):
        self.entries = entries
        self.clock = clock
        self.state_options = state_options

    def state_at(self, at):
        state = DashboardState(**self.state_options)
        # Event-time order (stable, so equal times keep their arrival order): a late
        # window is applied where it belongs, and the replay can stop at `at`.
        for t, kind, msg in sorted(self.entries, key=lambda e: e[0]):
            if t > at:
                break
            getattr(state, APPLY[kind])(msg)
        # The clock shows the requested moment (never beyond what the stream has reached).
        state.event_clock = max(min(at, self.clock), 0)
        return state

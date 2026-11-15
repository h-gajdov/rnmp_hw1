"""The live state plus a log of every message, so the dashboard can travel back in time.

`Timeline.apply()` updates the live DashboardState and inserts the message into a log
kept sorted by event time. `state_at(t)` rebuilds the picture as it was at event time
`t` by replaying the logged messages up to `t` into a DashboardState, so the past view
uses exactly the same rules as the live one.

A week of replayed days is ~300k messages, too many to replay on every request, so
the replay saves a copy of the state every `checkpoint_every` messages and later
requests start from the nearest checkpoint before `t` (a few milliseconds instead of a
few hundred). A message that arrives late is inserted where it belongs in event time
and discards the checkpoints after it; they are rebuilt by the next request.

The log keeps the last `keep_ms` of event time (default one week); older messages are
dropped as the stream advances, so a looping producer does not grow memory forever.
This module is pure Python, like state.py.
"""

from bisect import bisect_right, insort_right
from operator import itemgetter

from .state import DashboardState

HOUR_MS = 60 * 60 * 1000
DAY_MS = 24 * HOUR_MS
WEEK_MS = 7 * DAY_MS
WINDOWED = ("link_stats", "borough_stats")

APPLY = {
    "link_stats": "apply_link_stats",
    "borough_stats": "apply_borough_stats",
    "incident": "apply_incident",
    "reading": "apply_reading",
    "late_reading": "apply_late_reading",
}

by_time = itemgetter(0)


def event_time_of(kind, msg):
    """When a message 'happened': the end of its window, or its event time."""
    return msg["window_end"] if kind in WINDOWED else msg["event_time"]


class Timeline:
    def __init__(self, keep_ms=WEEK_MS, checkpoint_every=4000, **state_options):
        self.keep_ms = keep_ms
        self.checkpoint_every = checkpoint_every
        self.state_options = state_options
        self.live = DashboardState(**state_options)
        # (event_time, kind, msg), sorted by event time; equal times keep their arrival order
        self.entries = []
        # (index, state): the state after replaying entries[:index], sorted by index
        self.checkpoints = []
        # window_start -> {borough: window}, for the network series of the time bar
        self.borough_windows = {}
        self.newest = 0

    # ---- recording ------------------------------------------------------

    def apply(self, kind, msg):
        """Update the live state and remember the message. Returns False for a duplicate
        alert (nothing changed, nothing to push). Raises on a malformed message."""
        if getattr(self.live, APPLY[kind])(msg) is False:
            return False
        t = event_time_of(kind, msg)
        if kind in ("reading", "late_reading"):
            msg = {"event_time": t}  # replay only needs the time, keep the log small
        elif kind == "borough_stats":
            # A repeated borough window replaces the earlier one, like in the state.
            self.borough_windows.setdefault(msg["window_start"], {})[msg["borough"]] = msg

        entries = self.entries
        if not entries or t >= entries[-1][0]:
            entries.append((t, kind, msg))  # the usual case: newest so far
        else:
            pos = bisect_right(entries, t, key=by_time)
            entries.insert(pos, (t, kind, msg))
            # Checkpoints after the insert no longer describe entries[:index].
            while self.checkpoints and self.checkpoints[-1][0] > pos:
                self.checkpoints.pop()

        if t > self.newest:
            # Prune once per hour of stream time, not on every message.
            if t // HOUR_MS != self.newest // HOUR_MS:
                self._prune(t - self.keep_ms)
            self.newest = t
        return True

    def _prune(self, cutoff):
        cut = bisect_right(self.entries, cutoff - 1, key=by_time)  # entries older than cutoff
        if not cut:
            return
        del self.entries[:cut]
        # A checkpoint still holds the pruned messages' effect, which is harmless; it just
        # moves to its new index. Those that pointed into the pruned part are dropped.
        self.checkpoints = [(i - cut, s) for i, s in self.checkpoints if i >= cut]
        for start in [w for w in self.borough_windows if w < cutoff]:
            del self.borough_windows[start]

    # ---- reading --------------------------------------------------------

    @property
    def start(self):
        """Earliest event time the log can show (0 when empty)."""
        return self.entries[0][0] if self.entries else 0

    def state_at(self, at):
        """The dashboard state as it was at event time `at` (ms)."""
        end = bisect_right(self.entries, at, key=by_time)
        k = bisect_right(self.checkpoints, end, key=by_time)  # checkpoints with index <= end
        if k:
            index, saved = self.checkpoints[k - 1]
            state = saved.copy()
        else:
            index, state = 0, DashboardState(**self.state_options)

        last_saved = index
        for i in range(index, end):
            _, kind, msg = self.entries[i]
            getattr(state, APPLY[kind])(msg)
            if i + 1 - last_saved >= self.checkpoint_every:
                last_saved = i + 1
                insort_right(self.checkpoints, (last_saved, state.copy()), key=by_time)

        # The clock shows the requested moment (never beyond what the stream has reached).
        state.event_clock = max(min(at, self.live.event_clock), 0)
        return state

    def network_series(self):
        """Network speed and slow share per 5-minute window, for the time bar:
        borough windows combined, weighted by their readings."""
        series = []
        for start in sorted(self.borough_windows):
            parts = self.borough_windows[start].values()
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

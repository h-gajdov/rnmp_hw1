"""Compares the two runs of scripts/offset-experiment.sh and prints a Markdown report.

Usage: python3 scripts/offset_experiment_report.py experiment-out
Reads <dir>/latest/ and <dir>/earliest/ (topic dumps "CreateTime:<ms> Partition:<p> <key> <json>",
job.json and watermarks.json from the Flink REST API). Standard library only.
"""

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
MIN = 60_000
TOPICS = ["traffic-readings", "traffic-link-stats", "traffic-borough-stats", "traffic-incidents",
          "traffic-late-readings"]
OUTPUTS = TOPICS[1:]
ALERT_TYPES = ["SPEED_DROP", "PERSISTENT_CONGESTION", "RECOVERY", "SENSOR_SILENT"]


def ny(ms):
    return datetime.fromtimestamp(ms / 1000, NY).strftime("%H:%M:%S")


def wall(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone().strftime("%H:%M:%S.%f")[:-3]


def load_topic(path):
    """List of dicts: ts (Kafka CreateTime = wall clock when written), partition, key, value."""
    records = []
    for line in path.read_text().splitlines():
        if not line.startswith("CreateTime:"):
            continue
        ts, part, key, value = line.split("\t", 3)
        records.append({"ts": int(ts.split(":", 1)[1]), "partition": int(part.split(":", 1)[1]),
                        "key": key, "value": json.loads(value)})
    return records


def identity(topic, v):
    """What identifies one result (the rest of the message must then be equal)."""
    if topic == "traffic-link-stats":
        return v["link_id"], v["window_start"]
    if topic == "traffic-borough-stats":
        return v["borough"], v["window_start"]
    if topic == "traffic-incidents":
        return v["alert_id"]
    return v["link_id"], v["event_time"]   # readings / late readings


def comparable(topic, v):
    v = dict(v)
    if topic in ("traffic-readings", "traffic-late-readings"):
        v.pop("sent_at", None)                # wall clock of the producer
    if topic == "traffic-late-readings":
        v.pop("late_by_ms", None)             # depends on the watermark at arrival
    return json.dumps(v, sort_keys=True)


def load_run(d):
    run = {"dir": d, "topics": {t: load_topic(d / f"{t}.tsv") for t in TOPICS}}
    run["job"] = json.loads((d / "job.json").read_text())
    run["watermarks"] = json.loads((d / "watermarks.json").read_text())
    return run


def operator_watermark(run, name_part):
    """(min, max) current input watermark over the subtasks of the operator chain whose name contains name_part.
    If the REST API returned no metric for it, use the other keyed operators: they all read the same shuffled
    stream, so their input watermarks are the same."""
    found = {}
    for name, subtasks in run["watermarks"].items():
        values = [v for k, v in subtasks.items() if k.endswith("currentInputWatermark")]
        if values:
            found[name] = (min(values), max(values))
    for name, value in found.items():
        if name_part in name:
            return value
    return min(v for name, v in found.items() if not name.startswith("Source"))


def compare(topic, a, b):
    """Multiset comparison of two record lists. Returns a dict of findings."""
    ca = Counter((identity(topic, r["value"]), comparable(topic, r["value"])) for r in a)
    cb = Counter((identity(topic, r["value"]), comparable(topic, r["value"])) for r in b)
    ids_a = Counter(identity(topic, r["value"]) for r in a)
    ids_b = Counter(identity(topic, r["value"]) for r in b)
    order_a = defaultdict(list)
    order_b = defaultdict(list)
    for r in a:
        order_a[r["partition"]].append(identity(topic, r["value"]))
    for r in b:
        order_b[r["partition"]].append(identity(topic, r["value"]))
    # records with the same identity but different content: which fields, by how much
    va = {identity(topic, r["value"]): r["value"] for r in a}
    vb = {identity(topic, r["value"]): r["value"] for r in b}
    fields = Counter()
    max_abs = 0.0
    for k in va.keys() & vb.keys():
        if comparable(topic, va[k]) != comparable(topic, vb[k]):
            for f in va[k]:
                if f not in ("sent_at", "late_by_ms") and va[k].get(f) != vb[k].get(f):
                    fields[f] += 1
                    if isinstance(va[k][f], (int, float)) and isinstance(vb[k].get(f), (int, float)):
                        max_abs = max(max_abs, abs(va[k][f] - vb[k][f]))
    return {
        "fields": fields, "max_abs": max_abs,
        "identical": ca == cb,
        "only_a": sum((ca - cb).values()),
        "only_b": sum((cb - ca).values()),
        "dup_a": sum(n - 1 for n in ids_a.values() if n > 1),
        "dup_b": sum(n - 1 for n in ids_b.values() if n > 1),
        "same_partition": all(sorted(order_a[p]) == sorted(order_b[p]) for p in set(order_a) | set(order_b)),
        "same_order": order_a == order_b,
    }


def sliding_windows(t, size=15 * MIN, slide=5 * MIN):
    last = t - t % slide
    return [s for s in range(last, t - size, -slide)]


def end_of_data(run):
    """What never fired: windows whose end is past the final watermark, timers past it, open incidents."""
    readings = [r["value"] for r in run["topics"]["traffic-readings"]]
    late = {identity("traffic-late-readings", r["value"]) for r in run["topics"]["traffic-late-readings"]}
    on_time = [r for r in readings if (r["link_id"], r["event_time"]) not in late]
    wm_link = operator_watermark(run, "Link stats")[0]
    wm_borough = operator_watermark(run, "Borough stats")[0]
    wm_det = operator_watermark(run, "Incident detector")[0]

    link_windows = defaultdict(int)
    borough_windows = defaultdict(int)
    for r in on_time:
        for s in sliding_windows(r["event_time"]):
            link_windows[(r["link_id"], s)] += 1
        t = r["event_time"]
        borough_windows[(r["borough"], t - t % (5 * MIN))] += 1
    link_due = {k for k in link_windows if k[1] + 15 * MIN - 1 <= wm_link}
    borough_due = {k for k in borough_windows if k[0] and k[1] + 5 * MIN - 1 <= wm_borough}
    emitted_link = {identity("traffic-link-stats", r["value"]) for r in run["topics"]["traffic-link-stats"]}
    emitted_borough = {identity("traffic-borough-stats", r["value"]) for r in run["topics"]["traffic-borough-stats"]}
    pending_link = set(link_windows) - link_due
    pending_borough = {k for k in borough_windows if k[0]} - borough_due

    last_seen = {}
    for r in on_time:
        last_seen[r["link_id"]] = max(last_seen.get(r["link_id"], 0), r["event_time"])
    silence_pending = [l for l, t in last_seen.items() if t + 20 * MIN > wm_det]
    silence_fired_last = [l for l, t in last_seen.items() if t + 20 * MIN <= wm_det]

    alerts = defaultdict(list)
    for r in run["topics"]["traffic-incidents"]:
        alerts[r["value"]["link_id"]].append(r["value"])
    open_incidents, persistent_pending = [], []
    for link, items in alerts.items():
        items = [a for a in sorted(items, key=lambda a: a["event_time"]) if a["type"] != "SENSOR_SILENT"]
        if items and items[-1]["type"] != "RECOVERY":
            open_incidents.append(link)
            drop = items[-1] if items[-1]["type"] == "SPEED_DROP" else None
            if drop and drop["event_time"] + 15 * MIN > wm_det:
                persistent_pending.append(link)

    return {
        "last_event_time": max(r["event_time"] for r in readings),
        "wm_link": wm_link, "wm_borough": wm_borough, "wm_det": wm_det,
        "link_windows_total": len(link_windows),
        "link_windows_ok": link_due == emitted_link,
        "link_pending": len(pending_link),
        "link_pending_readings": sum(link_windows[k] for k in pending_link),
        "links_with_pending": len({k[0] for k in pending_link}),
        "borough_windows_total": len(borough_due | pending_borough),
        "borough_windows_ok": borough_due == emitted_borough,
        "borough_pending": sorted(pending_borough),
        "borough_pending_readings": sum(borough_windows[k] for k in pending_borough),
        "silence_pending": len(silence_pending),
        "silence_fired_last": len(silence_fired_last),
        "links": len(last_seen),
        "open_incidents": len(open_incidents),
        "persistent_pending": len(persistent_pending),
    }


def durations(run, start_ms):
    ins = [r["ts"] for r in run["topics"]["traffic-readings"]]
    outs = [r["ts"] for t in OUTPUTS for r in run["topics"][t]]
    last_per_topic = {t: max((r["ts"] for r in run["topics"][t]), default=None) for t in OUTPUTS}
    return {
        "input_first": min(ins), "input_last": max(ins),
        "output_first": min(outs), "output_last": max(outs),
        "start": start_ms, "total_s": (max(outs) - start_ms) / 1000,
        "last_per_topic": last_per_topic,
    }


def main(base):
    base = Path(base)
    L = load_run(base / "latest")
    E = load_run(base / "earliest")
    dl = durations(L, min(r["ts"] for r in L["topics"]["traffic-readings"]))
    de = durations(E, E["job"]["start-time"])

    p = print
    p("# Earliest vs latest: measured results\n")
    p("## Durations (wall clock)\n")
    p("| | latest | earliest |\n|---|---:|---:|")
    p(f"| measured from | first input record {wall(dl['start'])} | job start {wall(de['start'])} |")
    p(f"| producer writing the day | {(dl['input_last'] - dl['input_first']) / 1000:.1f} s "
      f"| {(de['input_last'] - de['input_first']) / 1000:.1f} s (before the job) |")
    p(f"| first output after start | {(dl['output_first'] - dl['start']) / 1000:.1f} s "
      f"| {(de['output_first'] - de['start']) / 1000:.1f} s |")
    p(f"| last output after start | **{dl['total_s']:.1f} s** | **{de['total_s']:.1f} s** |")
    p(f"| last output after last input record | {(dl['output_last'] - dl['input_last']) / 1000:.1f} s | - |")
    for t in OUTPUTS:
        a, b = dl["last_per_topic"][t], de["last_per_topic"][t]
        fa = f"{(a - dl['start']) / 1000:.1f} s" if a else "-"
        fb = f"{(b - de['start']) / 1000:.1f} s" if b else "-"
        p(f"| last `{t}` | {fa} | {fb} |")

    p("\n## Message counts\n")
    p("| topic | latest | earliest | same content | per-partition order |\n|---|---:|---:|---|---|")
    for t in TOPICS:
        c = compare(t, L["topics"][t], E["topics"][t])
        same = "yes" if c["identical"] else f"no: {c['only_a']} differ"
        if c["fields"]:
            same += " (" + ", ".join(f"`{f}`" for f in c["fields"]) + f", max difference {c['max_abs']:g})"
        dup = f", duplicates {c['dup_a']}/{c['dup_b']}" if c["dup_a"] or c["dup_b"] else ""
        order = "same" if c["same_order"] else ("same set, other order" if c["same_partition"] else "different")
        p(f"| `{t}` | {len(L['topics'][t])} | {len(E['topics'][t])} | {same}{dup} | {order} |")

    p("\n| alert type | latest | earliest |\n|---|---:|---:|")
    for name, run_key in (("latest", L), ("earliest", E)):
        run_key["types"] = Counter(r["value"]["type"] for r in run_key["topics"]["traffic-incidents"])
    for ty in ALERT_TYPES:
        p(f"| {ty} | {L['types'][ty]} | {E['types'][ty]} |")

    p("\n## When the data ends\n")
    for name, run in (("latest", L), ("earliest", E)):
        e = end_of_data(run)
        p(f"**{name}**: job state {run['job']['state']}; last event time {ny(e['last_event_time'])} NY; "
          f"final watermark link windows {ny(e['wm_link'])}, borough windows {ny(e['wm_borough'])}, "
          f"detector {ny(e['wm_det'])}.")
        p(f"- sliding windows: {e['link_windows_total']} with data, {e['link_pending']} never fired "
          f"({e['links_with_pending']} links, {e['link_pending_readings']} reading-window pairs); "
          f"emitted = expected-before-watermark: {e['link_windows_ok']}")
        bp = ", ".join(f"{b} {ny(s)}" for b, s in e["borough_pending"])
        p(f"- borough windows: {e['borough_windows_total']} with data, {len(e['borough_pending'])} never fired "
          f"({bp}; {e['borough_pending_readings']} readings); emitted = expected: {e['borough_windows_ok']}")
        p(f"- silence timers: {e['silence_pending']} of {e['links']} links still pending, "
          f"{e['silence_fired_last']} links went silent before the end (SENSOR_SILENT emitted)")
        p(f"- open incidents at the end: {e['open_incidents']}, of which {e['persistent_pending']} "
          f"with a pending 15-min persistence timer\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "experiment-out")

"""Download one day of NYC DOT real-time traffic speeds and the static link geometry.

Writes two files:
  * traffic.csv    - one row per reading (link_id, link_name, borough, speed, travel_time, status, data_as_of)
  * links.geojson  - one LineString per link ([lon, lat]), see docs/CONTRACT.md

Only the Python standard library is used, so this script runs without the venv.

Geometry notes (found by inspecting the API data):
  * `link_points` is cut off at 255 characters (the last point is often partial) and some
    coordinates are corrupted (e.g. "-74.841" instead of "-74.00841", or "-7.0").
  * `encoded_poly_line` (Google polyline format) is complete, but the API returns it with broken
    escaping: every "|" is preceded by a growing run of backslashes ("\\\\|"), and real backslashes
    (a valid polyline character) are duplicated. Undoing that gives a correct geometry.
  So we decode the polyline, and fall back to `link_points` only if the polyline is unusable.
  In both cases points outside the NYC bounding box and isolated "spikes" are dropped.
"""

import argparse
import csv
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

API_URL = "https://data.cityofnewyork.us/resource/i4gi-tjb9.json"
PAGE_SIZE = 50_000
CSV_FIELDS = ["link_id", "link_name", "borough", "speed", "travel_time", "status", "data_as_of"]

# Generous bounding box around the five boroughs (lat, lon).
NYC_LAT = (40.45, 40.95)
NYC_LON = (-74.30, -73.65)
# A point further than this (in degrees, ~2 km) from both of its neighbours is treated as corrupted.
SPIKE_DEG = 0.02


# ---------------------------------------------------------------- Socrata API

def fetch_json(params: dict) -> list:
    url = API_URL + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.load(resp)


def day_filter(start: str, end: str) -> str:
    # data_as_of is a "floating" timestamp in New York local time, compared as such.
    return f"data_as_of >= '{start}T00:00:00' AND data_as_of < '{end}T00:00:00'"


def download_readings(start: str, end: str) -> list:
    rows, offset = [], 0
    while True:
        page = fetch_json({
            "$select": ",".join(CSV_FIELDS),
            "$where": day_filter(start, end),
            "$order": "data_as_of, link_id",
            "$limit": PAGE_SIZE,
            "$offset": offset,
        })
        rows.extend(page)
        print(f"  fetched {len(rows)} readings", file=sys.stderr)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def download_link_metadata(start: str, end: str) -> list:
    """One row per distinct (link, geometry string) in the period."""
    fields = "link_id, link_name, borough, encoded_poly_line, link_points"
    return fetch_json({
        "$select": fields,
        "$group": fields,
        "$where": day_filter(start, end),
        "$limit": 50_000,
    })


# ---------------------------------------------------------------- geometry

def clean_polyline(raw: str) -> str:
    """Undo the API's broken escaping: collapse backslash runs, drop the ones escaping '|'."""
    s = re.sub(r"\\+", r"\\", raw)
    return s.replace("\\|", "|")


def decode_polyline(s: str) -> list:
    """Decode a Google encoded polyline into [(lat, lon), ...].

    Each value is a zig-zag encoded delta split into 5-bit chunks (char code - 63);
    a chunk < 0x20 ends the value. An incomplete trailing pair is ignored.
    """
    points, lat, lon, i = [], 0, 0, 0
    while i < len(s):
        deltas = []
        for _ in range(2):
            result, shift = 0, 0
            while i < len(s):
                b = ord(s[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    deltas.append(~(result >> 1) if result & 1 else result >> 1)
                    break
        if len(deltas) < 2:
            break
        lat += deltas[0]
        lon += deltas[1]
        points.append((lat / 1e5, lon / 1e5))
    return points


def parse_link_points(raw: str) -> list:
    """Parse 'lat,lon lat,lon ...'. The string is truncated at 255 chars, so the last token may be partial."""
    tokens = raw.split()
    if len(raw) >= 255 and tokens:
        tokens = tokens[:-1]
    points = []
    for tok in tokens:
        try:
            lat, lon = (float(v) for v in tok.split(","))
            points.append((lat, lon))
        except ValueError:
            continue
    return points


def in_nyc(p) -> bool:
    return NYC_LAT[0] <= p[0] <= NYC_LAT[1] and NYC_LON[0] <= p[1] <= NYC_LON[1]


def repair(points: list) -> list:
    """Drop points outside NYC, isolated spikes and consecutive duplicates."""
    pts = [p for p in points if in_nyc(p)]
    kept = []
    for i, p in enumerate(pts):
        neighbours = [pts[j] for j in (i - 1, i + 1) if 0 <= j < len(pts)]
        if neighbours and all(math.dist(p, n) > SPIKE_DEG for n in neighbours):
            continue  # spike
        if kept and kept[-1] == p:
            continue
        kept.append(p)
    return kept


def link_geometry(variants: list) -> tuple:
    """Pick the best geometry for one link from its API rows. Returns (points, source)."""
    for row in sorted(variants, key=lambda r: len(r.get("encoded_poly_line", ""))):
        pts = repair(decode_polyline(clean_polyline(row.get("encoded_poly_line", ""))))
        if len(pts) >= 2:
            return pts, "polyline"
    for row in variants:
        pts = repair(parse_link_points(row.get("link_points", "")))
        if len(pts) >= 2:
            return pts, "link_points"
    return [], "none"


def build_geojson(meta_rows: list) -> tuple:
    by_link = {}
    for row in meta_rows:
        by_link.setdefault(row["link_id"], []).append(row)

    features, sources = [], {}
    for link_id in sorted(by_link, key=int):
        rows = by_link[link_id]
        points, source = link_geometry(rows)
        sources[source] = sources.get(source, 0) + 1
        if not points:
            print(f"  WARNING: no usable geometry for link {link_id}", file=sys.stderr)
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "link_id": link_id,
                "link_name": rows[0].get("link_name", ""),
                "borough": rows[0].get("borough", ""),
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[lon, lat] for lat, lon in points],
            },
        })
    return {"type": "FeatureCollection", "features": features}, sources


# ---------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--start", default="2026-10-01", help="first day, YYYY-MM-DD (NY local time)")
    parser.add_argument("--end", default=None, help="exclusive end day, YYYY-MM-DD (default: start + 1 day)")
    parser.add_argument("--out", default="data/traffic.csv", help="output CSV path")
    parser.add_argument("--geojson", default=None, help="output GeoJSON path (default: links.geojson next to --out)")
    args = parser.parse_args(argv)

    end = args.end or (date.fromisoformat(args.start) + timedelta(days=1)).isoformat()
    out = Path(args.out)
    geo_out = Path(args.geojson) if args.geojson else out.with_name("links.geojson")
    out.parent.mkdir(parents=True, exist_ok=True)
    geo_out.parent.mkdir(parents=True, exist_ok=True)

    print(f"Downloading link geometry {args.start} .. {end}", file=sys.stderr)
    geojson, sources = build_geojson(download_link_metadata(args.start, end))
    geo_out.write_text(json.dumps(geojson))
    print(f"  wrote {len(geojson['features'])} links to {geo_out} (geometry source: {sources})", file=sys.stderr)

    print(f"Downloading readings {args.start} .. {end}", file=sys.stderr)
    rows = download_readings(args.start, end)
    with out.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"  wrote {len(rows)} readings to {out}", file=sys.stderr)


if __name__ == "__main__":
    main()

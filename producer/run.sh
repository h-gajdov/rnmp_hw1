#!/bin/sh
# Local helper: create the venv on first use, download the data if missing, run the producer.
# Usage: producer/run.sh [producer flags...]   e.g. producer/run.sh --speedup 120 --start-at 07:00
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"

if [ ! -x "$HERE/.venv/bin/python" ]; then
    uv venv --python 3.12 "$HERE/.venv"
    uv pip install --python "$HERE/.venv/bin/python" -r "$HERE/requirements.txt" -r "$HERE/requirements-dev.txt"
fi
if [ ! -s "$ROOT/data/traffic.csv" ] || [ ! -s "$ROOT/data/links.geojson" ]; then
    "$HERE/.venv/bin/python" "$HERE/download_data.py" --out "$ROOT/data/traffic.csv"
fi
exec "$HERE/.venv/bin/python" "$HERE/producer.py" --input "$ROOT/data/traffic.csv" "$@"

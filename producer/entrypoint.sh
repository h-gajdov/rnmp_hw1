#!/bin/sh
# Container start: download the data if the CSV or the GeoJSON is missing, then run the producer.
# Extra arguments (docker run ... <args>) are passed to producer.py.
set -e

INPUT="${INPUT:-/data/traffic.csv}"
GEOJSON="$(dirname "$INPUT")/links.geojson"

if [ ! -s "$INPUT" ] || [ ! -s "$GEOJSON" ]; then
    echo "data missing, downloading ${DATA_START:-2026-10-01} into $(dirname "$INPUT")"
    python download_data.py --start "${DATA_START:-2026-10-01}" ${DATA_END:+--end "$DATA_END"} --out "$INPUT"
fi

# exec: the producer becomes PID 1 and receives SIGTERM from `docker stop` directly.
exec python producer.py "$@"

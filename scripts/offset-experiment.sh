#!/usr/bin/env bash
# Earliest vs latest offset experiment (assignment, requirement 6) on the docker compose stack.
#
#   scripts/offset-experiment.sh            # both runs, then the comparison report
#   scripts/offset-experiment.sh latest     # only one run (earliest | latest | report)
#
# LATEST:   fresh stack -> job submitted with --offset latest -> producer replays the day at SPEEDUP=600
#           (the day in ~2.4 min). Duration = first input record -> last output record.
# EARLIEST: fresh stack -> producer writes the whole day at full speed (SPEEDUP=0) with no job running ->
#           job submitted with --offset earliest. Duration = job start -> last output record.
# Both runs use the same producer seed, so the input topic has the same records in the same order.
# After each run every topic is dumped to $OUT/<run>/ (raw data, not committed), then
# scripts/offset_experiment_report.py compares the two runs.
#
# Uses the host ports of the compose stack (9092, 8081): stop the course containers first
#   docker stop taskmanager jobmanager kafka      (and `docker start kafka jobmanager taskmanager` afterwards)
# The stack is left down (`docker compose down -v`) at the end.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${OUT:-experiment-out}"
LATEST_SPEEDUP="${LATEST_SPEEDUP:-600}"
QUIET_S="${QUIET_S:-90}"   # outputs unchanged this long (wall clock) = the job has nothing more to emit
FLINK_UI="http://localhost:${FLINK_UI_PORT:-8081}"
TOPICS="traffic-readings traffic-link-stats traffic-borough-stats traffic-incidents traffic-late-readings"
OUTPUT_TOPICS="traffic-link-stats traffic-borough-stats traffic-incidents traffic-late-readings"

dc() { docker compose "$@"; }
now_ms() { date +%s%3N; }
log() { echo "[$(date +%T)] $*"; }

# "<topic> <count>" for every traffic-* topic
counts() { scripts/consume.sh --counts; }

output_total() { counts | awk -v t=" $OUTPUT_TOPICS " 'index(t, " " $1 " ") { s += $2 } END { print s + 0 }'; }

# Waits until the output topics have not grown for QUIET_S seconds (and the producer has exited, if given).
wait_until_quiet() {
    local producer_service="${1:-}" prev=-1 last_change cur state
    last_change=$(date +%s)
    while true; do
        cur=$(output_total)
        if [ "$cur" != "$prev" ]; then
            prev=$cur
            last_change=$(date +%s)
            log "output records so far: $cur"
        fi
        state=exited
        if [ -n "$producer_service" ]; then
            state=$(docker inspect -f '{{.State.Status}}' "$(dc ps -aq "$producer_service")" 2>/dev/null || echo exited)
        fi
        if [ "$state" = exited ] && [ $(( $(date +%s) - last_change )) -ge "$QUIET_S" ]; then
            return
        fi
        sleep 2
    done
}

# Dumps every topic (CreateTime, partition, key, value per line) plus the job's metadata into $1.
collect() {
    local dir="$1" topic n jid
    mkdir -p "$dir"
    counts | tee "$dir/counts.txt"
    for topic in $TOPICS; do
        n=$(awk -v t="$topic" '$1 == t { print $2 }' "$dir/counts.txt")
        : > "$dir/$topic.tsv"
        if [ "${n:-0}" -gt 0 ]; then
            dc exec -T kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9093 \
                --topic "$topic" --from-beginning --max-messages "$n" --timeout-ms 60000 \
                --property print.timestamp=true --property print.partition=true --property print.key=true \
                > "$dir/$topic.tsv" 2>/dev/null || true
        fi
        log "dumped $(wc -l < "$dir/$topic.tsv") records of $topic"
    done
    curl -sf "$FLINK_UI/jobs/overview" > "$dir/jobs.json"
    jid=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["jobs"][0]["jid"])' "$dir/jobs.json")
    curl -sf "$FLINK_UI/jobs/$jid" > "$dir/job.json"
    # current input watermark of every subtask of every operator chain
    python3 - "$dir/job.json" "$FLINK_UI/jobs/$jid" > "$dir/watermarks.json" <<'EOF'
import json, sys, time, urllib.request
job = json.load(open(sys.argv[1]))
out = {}
for v in job["vertices"]:
    for attempt in range(10):   # the metric is sometimes missing right after a REST call; ask again
        with urllib.request.urlopen(f"{sys.argv[2]}/vertices/{v['id']}/watermarks") as r:
            out[v["name"]] = {m["id"]: int(m["value"]) for m in json.load(r)}
        if out[v["name"]] or v["name"].startswith("Source"):
            break
        time.sleep(1)
print(json.dumps(out, indent=1))
EOF
    dc logs --no-color flink-job producer > "$dir/compose.log" 2>&1 || true
}

run_latest() {
    local dir="$OUT/latest"
    log "=== LATEST: fresh stack, job first (--offset latest), then the producer at SPEEDUP=$LATEST_SPEEDUP"
    dc down -v --remove-orphans
    FLINK_OFFSET=latest dc up -d flink-job          # kafka, topics, Flink cluster, submit + wait until RUNNING
    dc wait flink-job
    echo "$(now_ms)" > "$OUT/latest.producer_start_ms"
    SPEEDUP="$LATEST_SPEEDUP" dc up -d --no-deps producer
    wait_until_quiet producer
    collect "$dir"
    mv "$OUT/latest.producer_start_ms" "$dir/producer_start_ms"
    dc down -v --remove-orphans
}

run_earliest() {
    local dir="$OUT/earliest"
    log "=== EARLIEST: fresh stack, producer first at full speed (no job running), then the job (--offset earliest)"
    dc down -v --remove-orphans
    dc up -d kafka-init
    dc wait kafka-init
    SPEEDUP=0 dc run --rm -T --no-deps producer
    dc up -d --wait jobmanager taskmanager
    echo "$(now_ms)" > "$OUT/earliest.submit_ms"
    FLINK_OFFSET=earliest dc up -d --no-deps flink-job
    dc wait flink-job
    wait_until_quiet
    collect "$dir"
    mv "$OUT/earliest.submit_ms" "$dir/submit_ms"
    dc down -v --remove-orphans
}

mkdir -p "$OUT"
what="${1:-all}"
if [ "$what" = all ] || [ "$what" = latest ] || [ "$what" = earliest ]; then
    dc build
fi
case "$what" in
    all) run_latest; run_earliest ;;
    latest) run_latest ;;
    earliest) run_earliest ;;
    report) ;;
    *) echo "usage: $0 [all|latest|earliest|report]" >&2; exit 2 ;;
esac
if [ -d "$OUT/latest" ] && [ -d "$OUT/earliest" ]; then
    python3 scripts/offset_experiment_report.py "$OUT" | tee "$OUT/report.md"
fi

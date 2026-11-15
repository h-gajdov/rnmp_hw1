#!/usr/bin/env bash
# Submits the Flink job (jar in /opt/flink/usrlib) to a running session cluster, waits until it runs, then exits.
# All arguments are passed to the job, e.g.: submit-job.sh --bootstrap kafka:9093 --offset earliest
set -euo pipefail

JOBMANAGER="${JOBMANAGER:-jobmanager:8081}"
JOB_NAME="NYC traffic analytics and incident detection"   # as in TrafficIncidentJob's env.execute(...)
RUNNING_TIMEOUT_S="${RUNNING_TIMEOUT_S:-120}"

echo "Waiting for the Flink JobManager at ${JOBMANAGER} with a registered TaskManager ..."
until curl -sf "http://${JOBMANAGER}/overview" | grep -q '"taskmanagers":[1-9]'; do
  sleep 2
done

# Restarting this container must not start a second copy of the job.
if curl -sf "http://${JOBMANAGER}/jobs/overview" | tr '{' '\n' \
    | grep "\"name\":\"${JOB_NAME}\"" | grep -q '"state":"RUNNING"'; then
  echo "'${JOB_NAME}' is already running, nothing to do."
  exit 0
fi

echo "Submitting with arguments: $*"
output="$(flink run -d -m "${JOBMANAGER}" /opt/flink/usrlib/traffic-job.jar "$@")"
echo "${output}"
job_id="$(echo "${output}" | grep -o 'JobID [0-9a-f]\{32\}' | tail -1 | cut -d' ' -f2)"

# Wait until every task of the job is RUNNING, so that whoever starts after this container
# (the producer in docker compose) does not write before a `--offset latest` source is reading.
echo "Waiting until all tasks of job ${job_id} are RUNNING ..."
deadline=$((SECONDS + RUNNING_TIMEOUT_S))
while true; do
  tasks="$(curl -sf "http://${JOBMANAGER}/jobs/overview" | grep -o "\"jid\":\"${job_id}\".*" \
           | grep -o '"tasks":{[^}]*}' | head -1 || true)"
  running="$(echo "${tasks}" | grep -o '"running":[0-9]*' | cut -d: -f2)"
  total="$(echo "${tasks}" | grep -o '"total":[0-9]*' | cut -d: -f2)"
  if [ -n "${running}" ] && [ "${running}" = "${total}" ]; then
    echo "Job ${job_id} is RUNNING (${running}/${total} tasks)."
    exit 0
  fi
  if [ "${SECONDS}" -ge "${deadline}" ]; then
    echo "Job ${job_id} not running after ${RUNNING_TIMEOUT_S}s (tasks: ${tasks})" >&2
    exit 1
  fi
  sleep 1
done

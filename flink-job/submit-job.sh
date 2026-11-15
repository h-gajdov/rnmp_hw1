#!/usr/bin/env bash
# Submits the Flink job (jar in /opt/flink/usrlib) to a running session cluster, then exits.
# All arguments are passed to the job, e.g.: submit-job.sh --bootstrap kafka:9093 --offset earliest
set -euo pipefail

JOBMANAGER="${JOBMANAGER:-jobmanager:8081}"
JOB_NAME="NYC traffic analytics and incident detection"   # as in TrafficIncidentJob's env.execute(...)

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
exec flink run -d -m "${JOBMANAGER}" /opt/flink/usrlib/traffic-job.jar "$@"

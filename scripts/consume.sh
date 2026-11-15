#!/bin/sh
# Prints messages of a topic (key | value) with the console consumer inside the compose Kafka.
#   scripts/consume.sh traffic-incidents                  # from the beginning, follow
#   scripts/consume.sh traffic-link-stats --max-messages 5
#   scripts/consume.sh --counts                           # number of messages in every topic
set -e
cd "$(dirname "$0")/.."

if [ "$1" = "--counts" ]; then
    docker compose exec -T kafka /opt/kafka/bin/kafka-get-offsets.sh \
        --bootstrap-server kafka:9093 --topic-partitions 'traffic-.*' --time -1 \
        | awk -F: '{ n[$1] += $3 } END { for (t in n) printf "%-24s %d\n", t, n[t] }' | sort
    exit
fi

topic="${1:?usage: scripts/consume.sh <topic> [console consumer options] | --counts}"
shift
exec docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
    --bootstrap-server kafka:9093 --topic "$topic" --from-beginning \
    --property print.key=true --property key.separator=' | ' "$@"

package mk.ukim.finki.rnmp.traffic.kafka;

import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.connector.base.DeliveryGuarantee;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.util.function.SerializableFunction;

import java.util.regex.Pattern;

/** Builds the Kafka source and sinks of the job. */
public final class KafkaFactory {

    private KafkaFactory() {
    }

    /**
     * @param fromEarliest true: read the whole topic from the beginning; false: only records produced
     *                     after the job started. Committed group offsets are ignored in both cases.
     */
    public static KafkaSource<TrafficReading> readingsSource(String bootstrap, String topic, String groupId,
                                                             boolean fromEarliest) {
        return KafkaSource.<TrafficReading>builder()
                .setBootstrapServers(bootstrap)
                // A pattern instead of setTopics(topic): the job does not fail when the topic does not exist
                // yet, it picks it up (and new partitions) through partition discovery.
                .setTopicPattern(Pattern.compile(Pattern.quote(topic)))
                .setProperty("partition.discovery.interval.ms", "10000")
                .setGroupId(groupId)
                .setStartingOffsets(fromEarliest ? OffsetsInitializer.earliest() : OffsetsInitializer.latest())
                .setDeserializer(new ReadingDeserializer())
                .build();
    }

    /** JSON sink with at-least-once delivery (records are flushed on every checkpoint). */
    public static <T> KafkaSink<T> jsonSink(String bootstrap, String topic, SerializableFunction<T, String> keyOf) {
        return KafkaSink.<T>builder()
                .setBootstrapServers(bootstrap)
                .setRecordSerializer(new JsonSerializer<>(topic, keyOf))
                .setDeliveryGuarantee(DeliveryGuarantee.AT_LEAST_ONCE)
                .build();
    }
}

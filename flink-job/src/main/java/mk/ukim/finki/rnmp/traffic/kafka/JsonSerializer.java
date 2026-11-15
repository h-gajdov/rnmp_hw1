package mk.ukim.finki.rnmp.traffic.kafka;

import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.util.function.SerializableFunction;
import org.apache.kafka.clients.producer.ProducerRecord;

import java.nio.charset.StandardCharsets;

/**
 * Writes any POJO as a JSON value, with a Kafka key taken from the object (link_id or borough),
 * so all messages of one link land in the same partition, in order.
 */
public class JsonSerializer<T> implements KafkaRecordSerializationSchema<T> {
    private final String topic;
    private final SerializableFunction<T, String> keyOf;

    public JsonSerializer(String topic, SerializableFunction<T, String> keyOf) {
        this.topic = topic;
        this.keyOf = keyOf;
    }

    @Override
    public ProducerRecord<byte[], byte[]> serialize(T element, KafkaSinkContext context, Long timestamp) {
        byte[] key = keyOf.apply(element).getBytes(StandardCharsets.UTF_8);
        return new ProducerRecord<>(topic, key, Json.toBytes(element));
    }
}

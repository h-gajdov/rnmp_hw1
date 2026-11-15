package mk.ukim.finki.rnmp.traffic.kafka;

import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.connector.kafka.source.reader.deserializer.KafkaRecordDeserializationSchema;
import org.apache.flink.util.Collector;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

/**
 * Turns the JSON value of a {@code traffic-readings} record into a {@link TrafficReading}.
 * A broken record is logged and skipped instead of failing (and endlessly restarting) the job.
 */
public class ReadingDeserializer implements KafkaRecordDeserializationSchema<TrafficReading> {
    private static final Logger LOG = LoggerFactory.getLogger(ReadingDeserializer.class);

    @Override
    public void deserialize(ConsumerRecord<byte[], byte[]> record, Collector<TrafficReading> out) {
        if (record.value() == null) {
            return;
        }
        try {
            TrafficReading reading = Json.fromBytes(record.value(), TrafficReading.class);
            if (reading.linkId == null || reading.eventTime <= 0) {
                LOG.warn("Skipping reading without link_id/event_time: {}", new String(record.value()));
                return;
            }
            out.collect(reading);
        } catch (IOException e) {
            LOG.warn("Skipping malformed JSON at {}-{}@{}: {}",
                    record.topic(), record.partition(), record.offset(), e.getMessage());
        }
    }

    @Override
    public TypeInformation<TrafficReading> getProducedType() {
        return TypeInformation.of(TrafficReading.class);
    }
}

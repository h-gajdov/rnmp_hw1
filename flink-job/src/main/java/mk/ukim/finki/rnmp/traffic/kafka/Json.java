package mk.ukim.finki.rnmp.traffic.kafka;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;

import java.io.IOException;

/**
 * The one place that decides how our POJOs look as JSON.
 * Java fields are camelCase ({@code avgSpeedMph}), the contract is snake_case ({@code avg_speed_mph}).
 */
public final class Json {

    /** ObjectMapper is thread-safe and expensive to create, so there is one per JVM. */
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            // contract: "unknown fields must be ignored by consumers"
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private Json() {
    }

    public static byte[] toBytes(Object value) {
        try {
            return MAPPER.writeValueAsBytes(value);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot serialize " + value, e);
        }
    }

    public static <T> T fromBytes(byte[] json, Class<T> type) throws IOException {
        return MAPPER.readValue(json, type);
    }
}

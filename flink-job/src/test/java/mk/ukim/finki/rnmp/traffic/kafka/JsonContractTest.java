package mk.ukim.finki.rnmp.traffic.kafka;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mk.ukim.finki.rnmp.traffic.model.BoroughWindowStats;
import mk.ukim.finki.rnmp.traffic.model.IncidentAlert;
import mk.ukim.finki.rnmp.traffic.model.LateReading;
import mk.ukim.finki.rnmp.traffic.model.LinkWindowStats;
import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The JSON field names must match docs/CONTRACT.md exactly; the dashboard depends on them. */
class JsonContractTest {

    private static final ObjectMapper PLAIN = new ObjectMapper();

    @Test
    void readsTheContractExampleAndIgnoresUnknownFields() throws Exception {
        String json = """
                {"link_id":"4616253","link_name":"CBE E TAYLOR AVENUE - CASTLE HILL AVENUE","borough":"Bronx",
                 "speed_mph":42.25,"travel_time_s":60,"data_as_of":"2026-10-01T00:28:10.000",
                 "event_time":1790829490000,"sent_at":1763215000123,"delayed":false,"some_future_field":1}""";
        TrafficReading r = Json.fromBytes(json.getBytes(StandardCharsets.UTF_8), TrafficReading.class);
        assertEquals("4616253", r.linkId);
        assertEquals("Bronx", r.borough);
        assertEquals(42.25, r.speedMph, 1e-9);
        assertEquals(60.0, r.travelTimeS, 1e-9);
        assertEquals("2026-10-01T00:28:10.000", r.dataAsOf);
        assertEquals(1790829490000L, r.eventTime);
        assertEquals(1763215000123L, r.sentAt);
    }

    @Test
    void linkStatsFields() throws Exception {
        assertFields(new LinkWindowStats(), "link_id", "link_name", "borough", "window_start", "window_end", "count",
                "avg_speed_mph", "min_speed_mph", "max_speed_mph", "stddev_speed_mph", "avg_travel_time_s",
                "free_flow_mph", "congestion_ratio", "level");
    }

    @Test
    void boroughStatsFields() throws Exception {
        assertFields(new BoroughWindowStats(), "borough", "window_start", "window_end", "readings", "links",
                "avg_speed_mph", "min_speed_mph", "max_speed_mph", "slow_readings", "slow_share");
    }

    @Test
    void incidentFieldsAndEnumsAsStrings() throws Exception {
        IncidentAlert a = new IncidentAlert();
        a.type = IncidentAlert.AlertType.SPEED_DROP;
        a.severity = IncidentAlert.Severity.HIGH;
        JsonNode node = assertFields(a, "alert_id", "type", "link_id", "link_name", "borough", "event_time",
                "incident_start", "duration_s", "speed_mph", "baseline_mph", "ratio", "min_speed_mph", "severity",
                "message");
        assertEquals("SPEED_DROP", node.get("type").asText());
        assertEquals("HIGH", node.get("severity").asText());
    }

    @Test
    void lateReadingIsTheReadingPlusLateBy() throws Exception {
        TrafficReading r = new TrafficReading();
        r.linkId = "1";
        r.eventTime = 1000;
        JsonNode node = assertFields(new LateReading(r, 250), "link_id", "link_name", "borough", "speed_mph",
                "travel_time_s", "data_as_of", "event_time", "sent_at", "delayed", "late_by_ms");
        assertEquals(250, node.get("late_by_ms").asLong());
        assertEquals("1", node.get("link_id").asText());
    }

    private static JsonNode assertFields(Object value, String... expected) throws Exception {
        JsonNode node = PLAIN.readTree(Json.toBytes(value));
        Set<String> actual = new TreeSet<>();
        node.fieldNames().forEachRemaining(actual::add);
        assertEquals(new TreeSet<>(Set.of(expected)), actual);
        return node;
    }
}

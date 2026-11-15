package mk.ukim.finki.rnmp.traffic.detection;

import mk.ukim.finki.rnmp.traffic.model.IncidentAlert;
import mk.ukim.finki.rnmp.traffic.model.IncidentAlert.AlertType;
import mk.ukim.finki.rnmp.traffic.model.IncidentAlert.Severity;
import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.streaming.api.operators.KeyedProcessOperator;
import org.apache.flink.streaming.util.KeyedOneInputStreamOperatorTestHarness;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Drives the detector with Flink's operator test harness: we push readings and watermarks by hand
 * and look at the alerts, so timers can be tested without Kafka or real time.
 * Defaults: drop &lt; 50%, recovery &gt;= 75% twice, persistent after 15 min, silent after 20 min, warm-up 3.
 */
class IncidentDetectorTest {

    private static final long T0 = 1_790_829_000_000L;
    private static final String LINK = "4616253";

    private KeyedOneInputStreamOperatorTestHarness<String, TrafficReading, IncidentAlert> harness;

    @BeforeEach
    void setUp() throws Exception {
        harness = new KeyedOneInputStreamOperatorTestHarness<>(
                new KeyedProcessOperator<>(new IncidentDetector(DetectorSettings.defaults())),
                r -> r.linkId, Types.STRING);
        harness.open();
    }

    @AfterEach
    void tearDown() throws Exception {
        harness.close();
    }

    @Test
    void noAlertsDuringWarmUp() throws Exception {
        send(40, 0);
        send(10, 5);      // would be a drop, but the baseline is still being learned
        send(40, 10);     // baseline = average of the 3 warm-up readings = 30
        send(25, 15);     // 83% of 30: normal
        assertTrue(alerts().isEmpty());
    }

    @Test
    void dropThenPersistentThenRecovery() throws Exception {
        warmUp();
        send(12, 15);
        send(15, 20);
        send(14, 25);
        watermark(30);    // 15 min after the drop, still in the incident
        send(35, 30);     // 87.5% of 40: first good reading
        send(38, 35);     // second good reading in a row: recovered

        List<IncidentAlert> alerts = alerts();
        assertEquals(List.of(AlertType.SPEED_DROP, AlertType.PERSISTENT_CONGESTION, AlertType.RECOVERY),
                alerts.stream().map(a -> a.type).toList());

        IncidentAlert drop = alerts.get(0);
        assertEquals(at(15), drop.eventTime);
        assertEquals(at(15), drop.incidentStart);
        assertEquals(40.0, drop.baselineMph, 1e-9);
        assertEquals(0.3, drop.ratio, 1e-9);
        assertEquals(Severity.MEDIUM, drop.severity);
        assertEquals(LINK + "-" + at(15) + "-SPEED_DROP", drop.alertId);

        IncidentAlert persistent = alerts.get(1);
        assertEquals(at(30), persistent.eventTime);
        assertEquals(15 * 60, persistent.durationS);
        assertEquals(14.0, persistent.speedMph, 1e-9);
        assertEquals(12.0, persistent.minSpeedMph, 1e-9);
        assertEquals(Severity.HIGH, persistent.severity);   // 35% of baseline, lasting 15 min

        IncidentAlert recovery = alerts.get(2);
        assertEquals(at(35), recovery.eventTime);
        assertEquals(at(15), recovery.incidentStart);
        assertEquals(20 * 60, recovery.durationS);
        assertEquals(12.0, recovery.minSpeedMph, 1e-9);
    }

    @Test
    void shortDropRecoversWithoutPersistentAlert() throws Exception {
        warmUp();
        send(12, 15);
        send(35, 20);
        send(36, 25);
        watermark(40);    // past the 15-min check: the timer was deleted on recovery

        List<IncidentAlert> alerts = alerts();
        assertEquals(List.of(AlertType.SPEED_DROP, AlertType.RECOVERY), alerts.stream().map(a -> a.type).toList());
        assertEquals(10 * 60, alerts.get(1).durationS);
    }

    @Test
    void recoveryNeedsConsecutiveGoodReadings() throws Exception {
        warmUp();
        send(12, 15);
        send(31, 17);     // good
        send(25, 19);     // below 75% again: the streak starts over
        send(31, 21);     // good
        assertEquals(1, alerts().size());
        send(32, 23);     // good, second in a row
        assertEquals(AlertType.RECOVERY, alerts().get(1).type);
    }

    @Test
    void silenceTimerFiresOnceWhenTheLinkStopsReporting() throws Exception {
        warmUp();         // last reading at minute 10
        watermark(29);
        assertTrue(alerts().isEmpty());
        watermark(30);    // 20 min after the last reading

        IncidentAlert silent = alerts().get(0);
        assertEquals(AlertType.SENSOR_SILENT, silent.type);
        assertEquals(at(30), silent.eventTime);
        assertEquals(at(10), silent.incidentStart);
        assertEquals(20 * 60, silent.durationS);

        watermark(60);    // not repeated while the link stays silent
        assertEquals(1, alerts().size());

        send(40, 61);     // the link is back, the timer is armed again
        watermark(81);
        assertEquals(2, alerts().size());
    }

    @Test
    void baselineIsLearnedAgainAfterSilence() throws Exception {
        warmUp();         // baseline 40
        send(15, 60);     // first reading after 50 min of silence: warm-up again, not a SPEED_DROP
        send(16, 65);
        send(14, 70);
        send(15, 75);     // normal for the new baseline of 15
        assertEquals(List.of(AlertType.SENSOR_SILENT), alerts().stream().map(a -> a.type).toList());
        send(5, 80);      // 33% of the new baseline: a real drop
        assertEquals(AlertType.SPEED_DROP, alerts().get(1).type);
    }

    /** Fast replay: the watermark lags behind, but a later reading proves the deadlines have passed. */
    @Test
    void overdueTimersAreHandledByTheNextReading() throws Exception {
        warmUp();
        send(12, 15);
        send(14, 31);     // no watermark at all, but minute 31 is past the 15-min check at minute 30
        send(13, 60);     // and minute 60 is past the silence deadline of the reading at minute 31

        List<IncidentAlert> alerts = alerts();
        assertEquals(List.of(AlertType.SPEED_DROP, AlertType.PERSISTENT_CONGESTION, AlertType.SENSOR_SILENT),
                alerts.stream().map(a -> a.type).toList());
        assertEquals(at(30), alerts.get(1).eventTime);
        assertEquals(12.0, alerts.get(1).speedMph, 1e-9);    // the speed known at minute 30
        assertEquals(at(51), alerts.get(2).eventTime);

        watermark(200);   // the deleted timers do not fire a second time; only the new silence timer does
        assertEquals(4, alerts().size());
    }

    @Test
    void readingsKeepPushingTheSilenceTimerForward() throws Exception {
        warmUp();
        send(40, 25);
        watermark(30);    // would have fired for the reading at minute 10, but not for minute 25
        assertTrue(alerts().isEmpty());
    }

    @Test
    void severityGrowsWithSlownessAndDuration() {
        assertEquals(Severity.LOW, IncidentDetector.severity(0.45, 0));
        assertEquals(Severity.MEDIUM, IncidentDetector.severity(0.35, 0));
        assertEquals(Severity.HIGH, IncidentDetector.severity(0.28, 0));
        assertEquals(Severity.CRITICAL, IncidentDetector.severity(0.10, 0));
        assertEquals(Severity.MEDIUM, IncidentDetector.severity(0.45, 15 * 60));
        assertEquals(Severity.HIGH, IncidentDetector.severity(0.45, 60 * 60));
        assertEquals(Severity.CRITICAL, IncidentDetector.severity(0.28, 60 * 60));
    }

    // --- helpers -------------------------------------------------------------------------------------

    private void warmUp() throws Exception {
        send(40, 0);
        send(40, 5);
        send(40, 10);
    }

    private void send(double speedMph, int minute) throws Exception {
        TrafficReading r = new TrafficReading();
        r.linkId = LINK;
        r.linkName = "CBE E TAYLOR AVENUE - CASTLE HILL AVENUE";
        r.borough = "Bronx";
        r.speedMph = speedMph;
        r.eventTime = at(minute);
        harness.processElement(r, r.eventTime);
    }

    private void watermark(int minute) throws Exception {
        harness.processWatermark(at(minute));
    }

    private List<IncidentAlert> alerts() {
        return harness.extractOutputValues();
    }

    private static long at(int minute) {
        return T0 + minute * 60_000L;
    }
}

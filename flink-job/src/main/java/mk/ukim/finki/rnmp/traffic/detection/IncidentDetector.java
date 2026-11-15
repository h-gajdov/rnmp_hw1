package mk.ukim.finki.rnmp.traffic.detection;

import mk.ukim.finki.rnmp.traffic.model.IncidentAlert;
import mk.ukim.finki.rnmp.traffic.model.IncidentAlert.AlertType;
import mk.ukim.finki.rnmp.traffic.model.IncidentAlert.Severity;
import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.api.common.functions.OpenContext;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

import java.util.Locale;

import static mk.ukim.finki.rnmp.traffic.Numbers.round;

/**
 * Event-driven module: one instance of this logic per link (the stream is keyed by link_id).
 *
 * <ul>
 *   <li><b>State</b> ({@link LinkState}): the link's learned baseline speed, its phase
 *       (NORMAL / DROPPED / CONGESTED) and the current incident.</li>
 *   <li><b>Event-time timers</b>: fire when the watermark passes a moment in event time.
 *       <ul>
 *         <li>persistence timer: 15 min after a SPEED_DROP, "is the link still in the incident?"</li>
 *         <li>silence timer: 20 min after the last reading; moved forward on every reading, so it only
 *             fires when a link stops reporting while the rest of the stream (the watermark) moves on.</li>
 *       </ul></li>
 * </ul>
 * Readings are processed in arrival order; the producer delays a reading by at most 2 minutes, while one link
 * reports only every ~5 minutes, so the readings of a single link practically never swap places.
 */
public class IncidentDetector extends KeyedProcessFunction<String, TrafficReading, IncidentAlert> {

    private final DetectorSettings settings;
    private transient ValueState<LinkState> linkState;

    public IncidentDetector(DetectorSettings settings) {
        this.settings = settings;
    }

    @Override
    public void open(OpenContext openContext) {
        linkState = getRuntimeContext().getState(new ValueStateDescriptor<>("link-state", LinkState.class));
    }

    @Override
    public void processElement(TrafficReading reading, Context ctx, Collector<IncidentAlert> out) throws Exception {
        LinkState s = linkState.value();
        if (s == null) {
            s = new LinkState();
        }
        s.readingsSeen++;
        s.linkName = reading.linkName;
        s.borough = reading.borough;
        s.lastSpeedMph = reading.speedMph;
        s.lastSeen = Math.max(s.lastSeen, reading.eventTime);
        restartSilenceTimer(s, ctx);

        if (s.readingsSeen <= settings.warmupReadings()) {
            updateBaseline(s, reading.speedMph);          // warm-up: only learn, never alert
        } else if (s.phase == Phase.NORMAL) {
            checkForDrop(s, reading, ctx, out);
        } else {
            checkForRecovery(s, reading, ctx, out);
        }
        linkState.update(s);
    }

    /** NORMAL: a reading far below the baseline opens an incident, any other reading refines the baseline. */
    private void checkForDrop(LinkState s, TrafficReading reading, Context ctx, Collector<IncidentAlert> out) {
        if (reading.speedMph >= settings.dropRatio() * s.baselineMph) {
            updateBaseline(s, reading.speedMph);
            return;
        }
        s.phase = Phase.DROPPED;
        s.incidentStart = reading.eventTime;
        s.incidentMinSpeedMph = reading.speedMph;
        s.readingsAboveRecovery = 0;
        s.persistentTimer = reading.eventTime + settings.persistentMs();
        ctx.timerService().registerEventTimeTimer(s.persistentTimer);

        double ratio = reading.speedMph / s.baselineMph;
        out.collect(alert(AlertType.SPEED_DROP, ctx.getCurrentKey(), s, reading.eventTime, reading.speedMph,
                severity(ratio, 0),
                String.format(Locale.ROOT, "Speed fell to %.1f mph (%.0f%% of the usual %.1f mph)",
                        reading.speedMph, ratio * 100, s.baselineMph)));
    }

    /**
     * DROPPED or CONGESTED: the incident ends only after several readings in a row are back above the
     * (higher) recovery threshold. Two thresholds (hysteresis) stop a link that hovers around 50% from
     * flapping between "incident" and "no incident".
     */
    private void checkForRecovery(LinkState s, TrafficReading reading, Context ctx, Collector<IncidentAlert> out) {
        s.incidentMinSpeedMph = Math.min(s.incidentMinSpeedMph, reading.speedMph);
        if (reading.speedMph < settings.recoveryRatio() * s.baselineMph) {
            s.readingsAboveRecovery = 0;
            return;
        }
        s.readingsAboveRecovery++;
        if (s.readingsAboveRecovery < settings.recoveryReadings()) {
            return;
        }
        long durationMs = reading.eventTime - s.incidentStart;
        out.collect(alert(AlertType.RECOVERY, ctx.getCurrentKey(), s, reading.eventTime, reading.speedMph,
                Severity.LOW,
                String.format(Locale.ROOT, "Back to %.1f mph after %d min (worst %.1f mph)",
                        reading.speedMph, durationMs / 60_000, s.incidentMinSpeedMph)));

        if (s.persistentTimer != 0) {                     // short incident: the 15-min check is not needed any more
            ctx.timerService().deleteEventTimeTimer(s.persistentTimer);
            s.persistentTimer = 0;
        }
        s.phase = Phase.NORMAL;
        s.readingsAboveRecovery = 0;
    }

    /** Called by Flink when the watermark passes a registered timer's time. */
    @Override
    public void onTimer(long timestamp, OnTimerContext ctx, Collector<IncidentAlert> out) throws Exception {
        LinkState s = linkState.value();
        if (s == null) {
            return;
        }
        if (timestamp == s.persistentTimer) {
            s.persistentTimer = 0;
            if (s.phase == Phase.DROPPED) {               // has not recovered within 15 min
                s.phase = Phase.CONGESTED;
                double ratio = s.lastSpeedMph / s.baselineMph;
                long durationS = (timestamp - s.incidentStart) / 1000;
                out.collect(alert(AlertType.PERSISTENT_CONGESTION, ctx.getCurrentKey(), s, timestamp,
                        s.lastSpeedMph, severity(ratio, durationS),
                        String.format(Locale.ROOT, "Still congested after %d min: %.1f mph (%.0f%% of the usual %.1f mph)",
                                durationS / 60, s.lastSpeedMph, ratio * 100, s.baselineMph)));
            }
        }
        if (timestamp == s.silenceTimer) {
            s.silenceTimer = 0;                           // not re-armed: one alert until the link reports again
            IncidentAlert silent = alert(AlertType.SENSOR_SILENT, ctx.getCurrentKey(), s, timestamp,
                    s.lastSpeedMph, Severity.MEDIUM,
                    String.format(Locale.ROOT, "No reading for %d min (last speed %.1f mph)",
                            settings.silenceMs() / 60_000, s.lastSpeedMph));
            silent.incidentStart = s.lastSeen;            // the silence started with the last reading
            silent.durationS = (timestamp - s.lastSeen) / 1000;
            out.collect(silent);
        }
        linkState.update(s);
    }

    /** Deletes the old silence timer and registers a new one, silenceMs after the latest reading. */
    private void restartSilenceTimer(LinkState s, Context ctx) {
        if (s.silenceTimer != 0) {
            ctx.timerService().deleteEventTimeTimer(s.silenceTimer);
        }
        s.silenceTimer = s.lastSeen + settings.silenceMs();
        ctx.timerService().registerEventTimeTimer(s.silenceTimer);
    }

    /**
     * Exponentially weighted moving average. During warm-up the weight is 1/n, i.e. a plain average of the
     * first readings (the very first reading becomes the baseline), afterwards a fixed alpha.
     */
    private void updateBaseline(LinkState s, double speedMph) {
        double alpha = Math.max(1.0 / s.readingsSeen, settings.baselineAlpha());
        s.baselineMph += alpha * (speedMph - s.baselineMph);
    }

    /** Severity from how slow the link is, one level higher for each long-lasting stage (15 min, 60 min). */
    static Severity severity(double ratio, long durationS) {
        int level;
        if (ratio < 0.15) level = 3;
        else if (ratio < 0.30) level = 2;
        else if (ratio < 0.40) level = 1;
        else level = 0;
        if (durationS >= 15 * 60) level++;
        if (durationS >= 60 * 60) level++;
        return Severity.values()[Math.min(level, Severity.CRITICAL.ordinal())];
    }

    private IncidentAlert alert(AlertType type, String linkId, LinkState s, long eventTime, double speedMph,
                                Severity severity, String message) {
        IncidentAlert a = new IncidentAlert();
        a.alertId = linkId + "-" + eventTime + "-" + type;
        a.type = type;
        a.linkId = linkId;
        a.linkName = s.linkName;
        a.borough = s.borough;
        a.eventTime = eventTime;
        a.incidentStart = s.phase.inIncident() ? s.incidentStart : eventTime;
        a.durationS = (eventTime - a.incidentStart) / 1000;
        a.speedMph = round(speedMph, 2);
        a.baselineMph = round(s.baselineMph, 2);
        a.ratio = s.baselineMph > 0 ? round(speedMph / s.baselineMph, 3) : 1.0;
        a.minSpeedMph = round(s.phase.inIncident() ? s.incidentMinSpeedMph : speedMph, 2);
        a.severity = severity;
        a.message = message;
        return a;
    }
}

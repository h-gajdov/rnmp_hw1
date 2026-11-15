package mk.ukim.finki.rnmp.traffic;

import mk.ukim.finki.rnmp.traffic.model.LateReading;
import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.streaming.api.functions.ProcessFunction;
import org.apache.flink.util.Collector;
import org.apache.flink.util.OutputTag;

/**
 * Splits the readings into on-time and late ones, right after the source.
 *
 * <p>A reading is late when its event time is not after the current watermark: the watermark is the
 * promise "nothing older will arrive", so windows (and timers) up to it may already have fired.
 * Instead of letting window operators drop such readings silently, they go to a side output
 * (and from there to {@code traffic-late-readings}).
 * Downstream operators see the minimum of the watermarks of their inputs, so a reading that passes
 * this filter is normally not late for them either, and analytics and detection see the same readings.
 */
public class LateReadingFilter extends ProcessFunction<TrafficReading, TrafficReading> {

    /** Anonymous subclass ({}) so Flink can capture the generic type. */
    public static final OutputTag<LateReading> LATE_READINGS = new OutputTag<>("late-readings") {};

    @Override
    public void processElement(TrafficReading reading, Context ctx, Collector<TrafficReading> out) {
        long watermark = ctx.timerService().currentWatermark();
        if (reading.eventTime <= watermark) {
            ctx.output(LATE_READINGS, new LateReading(reading, watermark - reading.eventTime));
        } else {
            out.collect(reading);
        }
    }
}

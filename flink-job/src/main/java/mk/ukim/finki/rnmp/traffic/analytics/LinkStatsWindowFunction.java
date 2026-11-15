package mk.ukim.finki.rnmp.traffic.analytics;

import mk.ukim.finki.rnmp.traffic.model.LinkWindowStats;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.streaming.api.functions.windowing.ProcessWindowFunction;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;

import static mk.ukim.finki.rnmp.traffic.Numbers.round;

/**
 * Called once when a link's window fires, with the single pre-aggregated accumulator.
 * Adds the window bounds and compares the window's average speed with the link's free-flow speed.
 *
 * <p>The free-flow speed must survive from one window to the next, so it lives in
 * {@code context.globalState()}: keyed state of the current link that is shared by all its windows.
 * ({@code context.windowState()} would be thrown away together with the window.)
 */
public class LinkStatsWindowFunction
        extends ProcessWindowFunction<LinkStatsAccumulator, LinkWindowStats, String, TimeWindow> {

    /**
     * free_flow = max(window average, previous free_flow * DECAY): it jumps up to any faster average at once and
     * otherwise slowly drifts down (about -0.2% per 5-minute window, roughly half per day), so one
     * unusually fast window does not dominate forever.
     */
    static final double FREE_FLOW_DECAY = 0.998;

    private final ValueStateDescriptor<Double> freeFlowDescriptor =
            new ValueStateDescriptor<>("free-flow-mph", Double.class);

    @Override
    public void process(String linkId, Context context, Iterable<LinkStatsAccumulator> results,
                        Collector<LinkWindowStats> out) throws Exception {
        LinkStatsAccumulator acc = results.iterator().next();
        double avgSpeed = acc.avgSpeed();

        ValueState<Double> freeFlowState = context.globalState().getState(freeFlowDescriptor);
        double freeFlow = nextFreeFlow(freeFlowState.value(), avgSpeed);
        freeFlowState.update(freeFlow);

        double ratio = congestionRatio(avgSpeed, freeFlow);

        LinkWindowStats stats = new LinkWindowStats();
        stats.linkId = linkId;
        stats.linkName = acc.linkName;
        stats.borough = acc.borough;
        stats.windowStart = context.window().getStart();
        stats.windowEnd = context.window().getEnd();
        stats.count = acc.count;
        stats.avgSpeedMph = round(avgSpeed, 2);
        stats.minSpeedMph = round(acc.minSpeed, 2);
        stats.maxSpeedMph = round(acc.maxSpeed, 2);
        stats.stddevSpeedMph = round(acc.stddevSpeed(), 2);
        stats.avgTravelTimeS = round(acc.avgTravelTime(), 1);
        stats.freeFlowMph = round(freeFlow, 2);
        stats.congestionRatio = round(ratio, 3);
        stats.level = levelOf(ratio);
        out.collect(stats);
    }

    static double nextFreeFlow(Double previous, double windowAvg) {
        return previous == null ? windowAvg : Math.max(windowAvg, previous * FREE_FLOW_DECAY);
    }

    static double congestionRatio(double avgSpeed, double freeFlow) {
        return freeFlow <= 0 ? 1.0 : Math.min(1.0, Math.max(0.0, avgSpeed / freeFlow));
    }

    static String levelOf(double ratio) {
        if (ratio >= 0.75) return "FREE";
        if (ratio >= 0.50) return "MODERATE";
        if (ratio >= 0.30) return "HEAVY";
        return "SEVERE";
    }
}

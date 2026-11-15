package mk.ukim.finki.rnmp.traffic.analytics;

import mk.ukim.finki.rnmp.traffic.model.BoroughWindowStats;
import org.apache.flink.streaming.api.functions.windowing.ProcessWindowFunction;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;

import static mk.ukim.finki.rnmp.traffic.Numbers.round;

/** Turns the borough accumulator into the output message and attaches the window bounds. */
public class BoroughStatsWindowFunction
        extends ProcessWindowFunction<BoroughStatsAccumulator, BoroughWindowStats, String, TimeWindow> {

    @Override
    public void process(String borough, Context context, Iterable<BoroughStatsAccumulator> results,
                        Collector<BoroughWindowStats> out) {
        BoroughStatsAccumulator acc = results.iterator().next();

        BoroughWindowStats stats = new BoroughWindowStats();
        stats.borough = borough;
        stats.windowStart = context.window().getStart();
        stats.windowEnd = context.window().getEnd();
        stats.readings = acc.readings;
        stats.links = acc.linkIds.size();
        stats.avgSpeedMph = round(acc.sumSpeed / acc.readings, 2);
        stats.minSpeedMph = round(acc.minSpeed, 2);
        stats.maxSpeedMph = round(acc.maxSpeed, 2);
        stats.slowReadings = acc.slowReadings;
        stats.slowShare = round((double) acc.slowReadings / acc.readings, 3);
        out.collect(stats);
    }
}

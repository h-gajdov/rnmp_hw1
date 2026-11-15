package mk.ukim.finki.rnmp.traffic.analytics;

import mk.ukim.finki.rnmp.traffic.model.BoroughWindowStats;
import mk.ukim.finki.rnmp.traffic.model.LinkWindowStats;
import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.windowing.assigners.SlidingEventTimeWindows;
import org.apache.flink.streaming.api.windowing.assigners.TumblingEventTimeWindows;
import org.apache.flink.util.CloseableIterator;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AnalyticsTest {

    private static final long T0 = 1_790_829_000_000L;   // a multiple of 5 minutes

    @Test
    void linkAccumulatorMath() {
        LinkStatsAggregator agg = new LinkStatsAggregator();
        LinkStatsAccumulator acc = agg.createAccumulator();
        agg.add(reading("A", "Bronx", 40, 0), acc);
        agg.add(reading("A", "Bronx", 30, 5), acc);
        LinkStatsAccumulator other = agg.add(reading("A", "Bronx", 20, 10), agg.createAccumulator());
        acc = agg.merge(acc, other);

        assertEquals(3, acc.count);
        assertEquals(30.0, acc.avgSpeed(), 1e-9);
        assertEquals(Math.sqrt(200.0 / 3), acc.stddevSpeed(), 1e-9);
        assertEquals(20.0, acc.minSpeed, 1e-9);
        assertEquals(40.0, acc.maxSpeed, 1e-9);
        assertEquals(60.0, acc.avgTravelTime(), 1e-9);
    }

    @Test
    void congestionLevelsAndFreeFlow() {
        assertEquals("FREE", LinkStatsWindowFunction.levelOf(0.75));
        assertEquals("MODERATE", LinkStatsWindowFunction.levelOf(0.7499));
        assertEquals("HEAVY", LinkStatsWindowFunction.levelOf(0.30));
        assertEquals("SEVERE", LinkStatsWindowFunction.levelOf(0.2999));
        assertEquals(1.0, LinkStatsWindowFunction.congestionRatio(50, 40), 1e-9);   // clamped
        assertEquals(40.0, LinkStatsWindowFunction.nextFreeFlow(null, 40), 1e-9);  // first window
        assertEquals(45.0, LinkStatsWindowFunction.nextFreeFlow(40.0, 45), 1e-9);  // jumps up at once
        assertEquals(39.92, LinkStatsWindowFunction.nextFreeFlow(40.0, 20), 1e-9); // decays slowly
    }

    /** Runs the real window pipeline on a tiny bounded input in a local mini-cluster. */
    @Test
    void slidingLinkWindowsKeepFreeFlowAcrossWindows() throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.setParallelism(1);
        DataStream<LinkWindowStats> stats = withEventTime(env,
                reading("A", "Bronx", 40, 0), reading("A", "Bronx", 30, 5), reading("A", "Bronx", 20, 10))
                .keyBy(r -> r.linkId)
                .window(SlidingEventTimeWindows.of(Duration.ofMinutes(15), Duration.ofMinutes(5)))
                .aggregate(new LinkStatsAggregator(), new LinkStatsWindowFunction());

        List<LinkWindowStats> out = collect(stats);
        out.sort(Comparator.comparingLong(s -> s.windowEnd));

        // every reading is in 3 windows: ends at minute 5, 10, 15, 20, 25
        assertEquals(5, out.size());
        LinkWindowStats full = out.get(2);                     // [0, 15): all three readings
        assertEquals(T0, full.windowStart);
        assertEquals(T0 + 15 * 60_000, full.windowEnd);
        assertEquals(3, full.count);
        assertEquals(30.0, full.avgSpeedMph, 1e-9);
        assertEquals(8.16, full.stddevSpeedMph, 1e-9);
        assertEquals(39.84, full.freeFlowMph, 1e-9);           // 40 from the first window, decayed twice
        assertEquals(0.753, full.congestionRatio, 1e-9);
        assertEquals("FREE", full.level);
        assertEquals("MODERATE", out.get(4).level);            // only the 20 mph reading: 20 / 39.68
        assertEquals("Bronx", full.borough);
    }

    @Test
    void tumblingBoroughWindows() throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.setParallelism(1);
        DataStream<BoroughWindowStats> stats = withEventTime(env,
                reading("A", "Manhattan", 10, 1), reading("C", "Bronx", 40, 1),
                reading("B", "Manhattan", 30, 2), reading("A", "Manhattan", 20, 3),
                reading("A", "Manhattan", 50, 6))                // next window
                .keyBy(r -> r.borough)
                .window(TumblingEventTimeWindows.of(Duration.ofMinutes(5)))
                .aggregate(new BoroughStatsAggregator(), new BoroughStatsWindowFunction());

        List<BoroughWindowStats> out = collect(stats);
        BoroughWindowStats manhattan = out.stream()
                .filter(s -> s.borough.equals("Manhattan") && s.windowStart == T0).findFirst().orElseThrow();
        assertEquals(T0 + 5 * 60_000, manhattan.windowEnd);
        assertEquals(3, manhattan.readings);
        assertEquals(2, manhattan.links);
        assertEquals(20.0, manhattan.avgSpeedMph, 1e-9);
        assertEquals(10.0, manhattan.minSpeedMph, 1e-9);
        assertEquals(30.0, manhattan.maxSpeedMph, 1e-9);
        assertEquals(1, manhattan.slowReadings);
        assertEquals(0.333, manhattan.slowShare, 1e-9);
        assertEquals(3, out.size());
    }

    private static DataStream<TrafficReading> withEventTime(StreamExecutionEnvironment env, TrafficReading... readings) {
        return env.fromData(readings).assignTimestampsAndWatermarks(
                WatermarkStrategy.<TrafficReading>forMonotonousTimestamps()
                        .withTimestampAssigner((r, ts) -> r.eventTime));
    }

    private static <T> List<T> collect(DataStream<T> stream) throws Exception {
        List<T> out = new ArrayList<>();
        try (CloseableIterator<T> it = stream.executeAndCollect()) {
            it.forEachRemaining(out::add);
        }
        return out;
    }

    private static TrafficReading reading(String linkId, String borough, double speed, int minute) {
        TrafficReading r = new TrafficReading();
        r.linkId = linkId;
        r.linkName = "Link " + linkId;
        r.borough = borough;
        r.speedMph = speed;
        r.travelTimeS = 60;
        r.eventTime = T0 + minute * 60_000L;
        return r;
    }
}

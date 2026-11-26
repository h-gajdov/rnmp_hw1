package mk.ukim.finki.rnmp.traffic.analytics;

import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.api.common.functions.AggregateFunction;

/** Incremental aggregation of all readings of one borough in one window. */
public class BoroughStatsAggregator
        implements AggregateFunction<TrafficReading, BoroughStatsAccumulator, BoroughStatsAccumulator> {

    /** A reading below this speed counts as "slow" (contract: speed_mph &lt; 15). */
    static final double SLOW_MPH = 20.0;
    static final double FAST_MPH = 50.0;

    @Override
    public BoroughStatsAccumulator createAccumulator() {
        return new BoroughStatsAccumulator();
    }

    @Override
    public BoroughStatsAccumulator add(TrafficReading reading, BoroughStatsAccumulator acc) {
        acc.readings++;
        acc.sumSpeed += reading.speedMph;
        acc.minSpeed = Math.min(acc.minSpeed, reading.speedMph);
        acc.maxSpeed = Math.max(acc.maxSpeed, reading.speedMph);
        if (reading.speedMph < SLOW_MPH) {
            acc.slowReadings++;
        }

        if (reading.speedMph > FAST_MPH) {
            acc.fastReadings++;
        }
        acc.linkIds.add(reading.linkId);
        return acc;
    }

    @Override
    public BoroughStatsAccumulator getResult(BoroughStatsAccumulator acc) {
        return acc;
    }

    @Override
    public BoroughStatsAccumulator merge(BoroughStatsAccumulator a, BoroughStatsAccumulator b) {
        a.readings += b.readings;
        a.sumSpeed += b.sumSpeed;
        a.minSpeed = Math.min(a.minSpeed, b.minSpeed);
        a.maxSpeed = Math.max(a.maxSpeed, b.maxSpeed);
        a.slowReadings += b.slowReadings;
        a.linkIds.addAll(b.linkIds);
        a.fastReadings += b.fastReadings;
        return a;
    }
}

package mk.ukim.finki.rnmp.traffic.analytics;

import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.api.common.functions.AggregateFunction;

/** Incremental aggregation: called once per reading as it arrives, not when the window fires. */
public class LinkStatsAggregator
        implements AggregateFunction<TrafficReading, LinkStatsAccumulator, LinkStatsAccumulator> {

    @Override
    public LinkStatsAccumulator createAccumulator() {
        return new LinkStatsAccumulator();
    }

    @Override
    public LinkStatsAccumulator add(TrafficReading reading, LinkStatsAccumulator acc) {
        acc.linkName = reading.linkName;
        acc.borough = reading.borough;
        acc.count++;
        acc.sumSpeed += reading.speedMph;
        acc.sumSquaredSpeed += reading.speedMph * reading.speedMph;
        acc.minSpeed = Math.min(acc.minSpeed, reading.speedMph);
        acc.maxSpeed = Math.max(acc.maxSpeed, reading.speedMph);
        acc.sumTravelTime += reading.travelTimeS;
        acc.maxTravelTimeS = Math.max(reading.travelTimeS, acc.maxTravelTimeS);
        System.out.println(acc.maxTravelTimeS);
        return acc;
    }

    @Override
    public LinkStatsAccumulator getResult(LinkStatsAccumulator acc) {
        return acc;
    }

    /** Only used by merging windows (session windows); kept correct anyway. */
    @Override
    public LinkStatsAccumulator merge(LinkStatsAccumulator a, LinkStatsAccumulator b) {
        if (a.linkName == null) {
            a.linkName = b.linkName;
            a.borough = b.borough;
        }
        a.count += b.count;
        a.sumSpeed += b.sumSpeed;
        a.sumSquaredSpeed += b.sumSquaredSpeed;
        a.minSpeed = Math.min(a.minSpeed, b.minSpeed);
        a.maxSpeed = Math.max(a.maxSpeed, b.maxSpeed);
        a.sumTravelTime += b.sumTravelTime;
        a.maxTravelTimeS = Math.max(a.maxTravelTimeS, b.maxTravelTimeS);
        return a;
    }
}

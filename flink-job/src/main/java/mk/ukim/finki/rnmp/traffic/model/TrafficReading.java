package mk.ukim.finki.rnmp.traffic.model;

/**
 * One speed reading of one road segment ("link"), as sent by the producer to {@code traffic-readings}.
 *
 * <p>Flink POJO rules: public class, public no-arg constructor, public fields. Field names are camelCase
 * here and snake_case in JSON (see {@code kafka.Json}).
 */
public class TrafficReading {
    public String linkId;
    public String linkName;
    public String borough;
    public double speedMph;
    public double travelTimeS;
    public String dataAsOf;
    /** Event time in epoch ms (UTC). Flink's timestamps and watermarks are based on this field. */
    public long eventTime;
    public long sentAt;
    /** Set by the producer for records it deliberately sent out of order. Debug only, the job ignores it. */
    public boolean delayed;

    public TrafficReading() {
    }

    /** Copy constructor, used by {@link LateReading}. */
    public TrafficReading(TrafficReading other) {
        this.linkId = other.linkId;
        this.linkName = other.linkName;
        this.borough = other.borough;
        this.speedMph = other.speedMph;
        this.travelTimeS = other.travelTimeS;
        this.dataAsOf = other.dataAsOf;
        this.eventTime = other.eventTime;
        this.sentAt = other.sentAt;
        this.delayed = other.delayed;
    }

    @Override
    public String toString() {
        return "TrafficReading{" + linkId + " " + speedMph + " mph @ " + eventTime + "}";
    }
}

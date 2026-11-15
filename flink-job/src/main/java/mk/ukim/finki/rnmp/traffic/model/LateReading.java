package mk.ukim.finki.rnmp.traffic.model;

/** A reading that arrived behind the watermark, written to {@code traffic-late-readings}. */
public class LateReading extends TrafficReading {
    /** How far behind the watermark the reading was: watermark - event_time. */
    public long lateByMs;

    public LateReading() {
    }

    public LateReading(TrafficReading reading, long lateByMs) {
        super(reading);
        this.lateByMs = lateByMs;
    }
}

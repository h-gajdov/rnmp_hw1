package mk.ukim.finki.rnmp.traffic.detection;

/**
 * Everything the detector remembers about one link, stored as one Flink {@code ValueState}
 * (keyed by link_id, checkpointed, restored after a failure).
 */
public class LinkState {
    // what the link usually looks like
    public double baselineMph;
    public long readingsSeen;

    // the last reading (also used by timer alerts, which have no reading of their own)
    public String linkName;
    public String borough;
    public double lastSpeedMph;
    public long lastSeen;

    // the current incident
    public Phase phase = Phase.NORMAL;
    public long incidentStart;
    public double incidentMinSpeedMph;
    public int readingsAboveRecovery;

    // registered event-time timers (0 = none), remembered so they can be deleted or recognized in onTimer
    public long persistentTimer;
    public long silenceTimer;

    public LinkState() {
    }
}

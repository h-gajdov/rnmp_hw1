package mk.ukim.finki.rnmp.traffic.model;

/** Tumbling-window statistics of one borough, written to {@code traffic-borough-stats}. */
public class BoroughWindowStats {
    public String borough;
    public long windowStart;
    public long windowEnd;
    public long readings;
    /** Number of distinct links that reported in the window. */
    public long links;
    public double avgSpeedMph;
    public double minSpeedMph;
    public double maxSpeedMph;
    public long slowReadings;
    public double slowShare;

    public BoroughWindowStats() {
    }
}

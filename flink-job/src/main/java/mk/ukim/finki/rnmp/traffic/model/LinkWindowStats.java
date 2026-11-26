package mk.ukim.finki.rnmp.traffic.model;

/** Sliding-window statistics of one link, written to {@code traffic-link-stats}. */
public class LinkWindowStats {
    public String linkId;
    public String linkName;
    public String borough;
    public long windowStart;
    public long windowEnd;
    public long count;
    public double avgSpeedMph;
    public double minSpeedMph;
    public double maxSpeedMph;
    public double stddevSpeedMph;
    public double avgTravelTimeS;
    public double freeFlowMph;
    public double congestionRatio;
    public double maxTravelTimeS;
    /** FREE, MODERATE, HEAVY or SEVERE. */
    public String level;

    public LinkWindowStats() {
    }
}

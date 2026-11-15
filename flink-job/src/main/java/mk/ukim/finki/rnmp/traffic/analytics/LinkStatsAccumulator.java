package mk.ukim.finki.rnmp.traffic.analytics;

/**
 * Running totals of one link in one window. Small and constant in size: Flink keeps one of these per
 * (link, window) instead of buffering all readings of the window.
 */
public class LinkStatsAccumulator {
    public String linkName;
    public String borough;
    public long count;
    public double sumSpeed;
    /** Sum of squared speeds, for the standard deviation: var = E[x^2] - E[x]^2. */
    public double sumSquaredSpeed;
    public double minSpeed = Double.MAX_VALUE;
    public double maxSpeed = -Double.MAX_VALUE;
    public double sumTravelTime;

    public LinkStatsAccumulator() {
    }

    public double avgSpeed() {
        return sumSpeed / count;
    }

    public double stddevSpeed() {
        double mean = avgSpeed();
        double variance = sumSquaredSpeed / count - mean * mean;
        return Math.sqrt(Math.max(0, variance)); // max(0, ...) guards against tiny negative rounding errors
    }

    public double avgTravelTime() {
        return sumTravelTime / count;
    }
}

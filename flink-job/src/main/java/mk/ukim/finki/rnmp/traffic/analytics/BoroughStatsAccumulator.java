package mk.ukim.finki.rnmp.traffic.analytics;

import java.util.HashSet;

/** Running totals of one borough in one 5-minute window. */
public class BoroughStatsAccumulator {
    public long readings;
    public double sumSpeed;
    public double minSpeed = Double.MAX_VALUE;
    public double maxSpeed = -Double.MAX_VALUE;
    public long slowReadings;
    public long fastReadings;
    public double fastShare;
    /** Distinct links seen in the window (~125 links in the city, so this stays small). */
    public HashSet<String> linkIds = new HashSet<>();

    public BoroughStatsAccumulator() {
    }
}

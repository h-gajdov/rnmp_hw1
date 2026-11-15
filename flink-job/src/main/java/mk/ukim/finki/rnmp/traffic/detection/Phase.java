package mk.ukim.finki.rnmp.traffic.detection;

/**
 * Where a link is in its incident life cycle.
 * <pre>
 *   NORMAL --SPEED_DROP--> DROPPED --PERSISTENT_CONGESTION (timer)--> CONGESTED
 *      ^                      |                                          |
 *      +------RECOVERY--------+--------------RECOVERY--------------------+
 * </pre>
 */
public enum Phase {
    NORMAL, DROPPED, CONGESTED;

    public boolean inIncident() {
        return this != NORMAL;
    }
}

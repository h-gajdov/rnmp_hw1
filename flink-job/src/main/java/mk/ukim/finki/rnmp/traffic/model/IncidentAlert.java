package mk.ukim.finki.rnmp.traffic.model;

/** One step of an incident's life cycle, written to {@code traffic-incidents}. */
public class IncidentAlert {
    public String alertId;
    public AlertType type;
    public String linkId;
    public String linkName;
    public String borough;
    public long eventTime;
    public long incidentStart;
    public long durationS;
    public double speedMph;
    public double baselineMph;
    public double ratio;
    public double minSpeedMph;
    public Severity severity;
    public String message;

    public IncidentAlert() {
    }

    public enum AlertType { SPEED_DROP, PERSISTENT_CONGESTION, RECOVERY, SENSOR_SILENT, LONG_INCIDENT }

    public enum Severity { LOW, MEDIUM, HIGH, CRITICAL }

    @Override
    public String toString() {
        return "IncidentAlert{" + type + " " + linkId + " @ " + eventTime + ", " + message + "}";
    }
}

package mk.ukim.finki.rnmp.traffic;

import mk.ukim.finki.rnmp.traffic.detection.DetectorSettings;
import org.apache.flink.util.ParameterTool;

/**
 * Command-line arguments of the job, e.g. {@code --bootstrap kafka:9093 --offset earliest}.
 * Every flag is optional; the defaults match docs/CONTRACT.md.
 */
public record JobConfig(String bootstrap,
                        boolean fromEarliest,
                        String groupId,
                        String readingsTopic,
                        String linkStatsTopic,
                        String boroughStatsTopic,
                        String incidentsTopic,
                        String lateTopic,
                        long maxOutOfOrdernessS,
                        long idleS,
                        int parallelism,
                        DetectorSettings detector) {

    public static JobConfig fromArgs(String[] args) {
        ParameterTool p = ParameterTool.fromArgs(args);

        String offset = p.get("offset", "latest");
        if (!offset.equals("earliest") && !offset.equals("latest")) {
            throw new IllegalArgumentException("--offset must be 'earliest' or 'latest', got: " + offset);
        }

        DetectorSettings d = DetectorSettings.defaults();
        DetectorSettings detector = new DetectorSettings(
                p.getDouble("drop-ratio", d.dropRatio()),
                p.getDouble("recovery-ratio", d.recoveryRatio()),
                p.getInt("recovery-readings", d.recoveryReadings()),
                p.getLong("persistent-min", d.persistentMs() / 60_000) * 60_000,
                p.getLong("silence-min", d.silenceMs() / 60_000) * 60_000,
                p.getInt("warmup-readings", d.warmupReadings()),
                p.getDouble("baseline-alpha", d.baselineAlpha()));

        return new JobConfig(
                p.get("bootstrap", "localhost:9092"),
                offset.equals("earliest"),
                p.get("group-id", "traffic-flink-job"),
                p.get("readings-topic", "traffic-readings"),
                p.get("link-stats-topic", "traffic-link-stats"),
                p.get("borough-stats-topic", "traffic-borough-stats"),
                p.get("incidents-topic", "traffic-incidents"),
                p.get("late-topic", "traffic-late-readings"),
                p.getLong("max-ooo-s", 120),
                p.getLong("idle-s", 30),
                p.getInt("parallelism", 0),   // 0 = Flink's default
                detector);
    }
}

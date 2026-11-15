package mk.ukim.finki.rnmp.traffic.detection;

import java.io.Serializable;

/**
 * Thresholds of the incident detector (all configurable from the command line).
 *
 * @param dropRatio        a reading below dropRatio * baseline opens an incident (SPEED_DROP)
 * @param recoveryRatio    a reading at or above recoveryRatio * baseline counts towards RECOVERY
 * @param recoveryReadings how many such readings in a row close the incident (hysteresis)
 * @param persistentMs     event time after the drop at which PERSISTENT_CONGESTION is checked
 * @param silenceMs        event time without readings after which SENSOR_SILENT is sent
 * @param warmupReadings   readings used only to learn the baseline before any alert is possible
 * @param baselineAlpha    weight of a new reading in the moving-average baseline (EWMA)
 */
public record DetectorSettings(double dropRatio,
                               double recoveryRatio,
                               int recoveryReadings,
                               long persistentMs,
                               long silenceMs,
                               int warmupReadings,
                               double baselineAlpha) implements Serializable {

    public static DetectorSettings defaults() {
        return new DetectorSettings(0.50, 0.75, 2, 15 * 60_000L, 20 * 60_000L, 3, 0.10);
    }
}

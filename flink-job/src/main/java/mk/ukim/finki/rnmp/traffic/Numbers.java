package mk.ukim.finki.rnmp.traffic;

/** Rounding for the JSON output, so messages stay short and readable. */
public final class Numbers {

    private Numbers() {
    }

    public static double round(double value, int decimals) {
        double scale = Math.pow(10, decimals);
        return Math.round(value * scale) / scale;
    }
}

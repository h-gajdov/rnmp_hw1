package mk.ukim.finki.rnmp.traffic;

import mk.ukim.finki.rnmp.traffic.analytics.BoroughStatsAggregator;
import mk.ukim.finki.rnmp.traffic.analytics.BoroughStatsWindowFunction;
import mk.ukim.finki.rnmp.traffic.analytics.LinkStatsAggregator;
import mk.ukim.finki.rnmp.traffic.analytics.LinkStatsWindowFunction;
import mk.ukim.finki.rnmp.traffic.detection.IncidentDetector;
import mk.ukim.finki.rnmp.traffic.kafka.KafkaFactory;
import mk.ukim.finki.rnmp.traffic.model.BoroughWindowStats;
import mk.ukim.finki.rnmp.traffic.model.IncidentAlert;
import mk.ukim.finki.rnmp.traffic.model.LateReading;
import mk.ukim.finki.rnmp.traffic.model.LinkWindowStats;
import mk.ukim.finki.rnmp.traffic.model.TrafficReading;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.datastream.SingleOutputStreamOperator;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.windowing.assigners.SlidingEventTimeWindows;
import org.apache.flink.streaming.api.windowing.assigners.TumblingEventTimeWindows;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;

/**
 * NYC traffic: windowed analytics + incident detection.
 *
 * <pre>
 * traffic-readings ─► watermarks ─► late filter ─┬─► keyBy link    ─► sliding 15m/5m window ─► traffic-link-stats
 *                                       │        ├─► keyBy borough ─► tumbling 5m window    ─► traffic-borough-stats
 *                                       │        └─► keyBy link    ─► IncidentDetector       ─► traffic-incidents
 *                                       └─(side output)────────────────────────────────────► traffic-late-readings
 * </pre>
 */
public class TrafficIncidentJob {
    private static final Logger LOG = LoggerFactory.getLogger(TrafficIncidentJob.class);

    static final Duration LINK_WINDOW_SIZE = Duration.ofMinutes(15);
    static final Duration LINK_WINDOW_SLIDE = Duration.ofMinutes(5);
    static final Duration BOROUGH_WINDOW_SIZE = Duration.ofMinutes(5);

    public static void main(String[] args) throws Exception {
        JobConfig config = JobConfig.fromArgs(args);
        LOG.info("Starting with {}", config);

        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        if (config.parallelism() > 0) {
            env.setParallelism(config.parallelism());
        }
        // Snapshot all state (windows, baselines, timers, Kafka offsets) every 10 s; the Kafka sinks flush on
        // every checkpoint, which gives at-least-once delivery.
        env.enableCheckpointing(10_000);

        // Event time comes from the reading itself. The watermark trails the largest event time seen by
        // max-ooo-s (120 s = the producer's maximum deliberate delay), so a delayed reading is normally still
        // on time. A Kafka partition without data for idle-s is ignored when computing the watermark,
        // otherwise one empty partition would hold back the watermark (and all windows) forever.
        WatermarkStrategy<TrafficReading> watermarks = WatermarkStrategy
                .<TrafficReading>forBoundedOutOfOrderness(Duration.ofSeconds(config.maxOutOfOrdernessS()))
                .withTimestampAssigner((reading, kafkaTimestamp) -> reading.eventTime)
                .withIdleness(Duration.ofSeconds(config.idleS()));

        SingleOutputStreamOperator<TrafficReading> readings = env
                .fromSource(KafkaFactory.readingsSource(config.bootstrap(), config.readingsTopic(),
                        config.groupId(), config.fromEarliest()), watermarks, "Kafka: " + config.readingsTopic())
                .uid("readings-source")
                .process(new LateReadingFilter())
                .name("Split off late readings").uid("late-filter");

        buildAnalytics(readings, config);
        buildIncidentDetection(readings, config);

        DataStream<LateReading> late = readings.getSideOutput(LateReadingFilter.LATE_READINGS);
        late.sinkTo(KafkaFactory.jsonSink(config.bootstrap(), config.lateTopic(), r -> r.linkId))
                .name("Kafka: " + config.lateTopic()).uid("late-sink");

        env.execute("NYC traffic analytics and incident detection");
    }

    /** Analytics module: event-time windows per link and per borough. */
    private static void buildAnalytics(DataStream<TrafficReading> readings, JobConfig config) {
        DataStream<LinkWindowStats> linkStats = readings
                .keyBy(r -> r.linkId)
                .window(SlidingEventTimeWindows.of(LINK_WINDOW_SIZE, LINK_WINDOW_SLIDE))
                .aggregate(new LinkStatsAggregator(), new LinkStatsWindowFunction())
                .name("Link stats (sliding 15m / 5m)").uid("link-stats");
        linkStats.sinkTo(KafkaFactory.jsonSink(config.bootstrap(), config.linkStatsTopic(), s -> s.linkId))
                .name("Kafka: " + config.linkStatsTopic()).uid("link-stats-sink");

        DataStream<BoroughWindowStats> boroughStats = readings
                .keyBy(r -> r.borough == null ? "Unknown" : r.borough)
                .window(TumblingEventTimeWindows.of(BOROUGH_WINDOW_SIZE))
                .aggregate(new BoroughStatsAggregator(), new BoroughStatsWindowFunction())
                .name("Borough stats (tumbling 5m)").uid("borough-stats");
        boroughStats.sinkTo(KafkaFactory.jsonSink(config.bootstrap(), config.boroughStatsTopic(), s -> s.borough))
                .name("Kafka: " + config.boroughStatsTopic()).uid("borough-stats-sink");
    }

    /** Event-driven module: per-link state machine with state and event-time timers. */
    private static void buildIncidentDetection(DataStream<TrafficReading> readings, JobConfig config) {
        DataStream<IncidentAlert> incidents = readings
                .keyBy(r -> r.linkId)
                .process(new IncidentDetector(config.detector()))
                .name("Incident detector").uid("incident-detector");
        incidents.sinkTo(KafkaFactory.jsonSink(config.bootstrap(), config.incidentsTopic(), a -> a.linkId))
                .name("Kafka: " + config.incidentsTopic()).uid("incidents-sink");
    }
}

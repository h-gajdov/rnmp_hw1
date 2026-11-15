"""Command-line flags of the bridge. Every flag can also be set with an env var
(handy inside Docker), the flag wins when both are given."""

import argparse
import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass
class Config:
    bootstrap: str
    link_stats_topic: str
    borough_stats_topic: str
    incidents_topic: str
    readings_topic: str
    late_topic: str
    topic_prefix: str
    offset: str
    host: str
    port: int
    links_geojson: Path
    web_dist: Path
    history_hours: float

    @property
    def topics(self):
        """Topic name -> kind; an empty name disables that topic."""
        named = {
            self.link_stats_topic: "link_stats",
            self.borough_stats_topic: "borough_stats",
            self.incidents_topic: "incident",
            self.readings_topic: "reading",
            self.late_topic: "late_reading",
        }
        return {self.topic_prefix + name: kind for name, kind in named.items() if name}


def _env(name, default):
    return os.environ.get(name, default)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Kafka -> Socket.IO bridge for the traffic dashboard")
    p.add_argument("--bootstrap", default=_env("KAFKA_BOOTSTRAP", "localhost:9092"))
    p.add_argument("--link-stats-topic", default=_env("LINK_STATS_TOPIC", "traffic-link-stats"))
    p.add_argument("--borough-stats-topic", default=_env("BOROUGH_STATS_TOPIC", "traffic-borough-stats"))
    p.add_argument("--incidents-topic", default=_env("INCIDENTS_TOPIC", "traffic-incidents"))
    p.add_argument("--readings-topic", default=_env("READINGS_TOPIC", "traffic-readings"),
                   help="raw readings, used for the live message rate (empty string = off)")
    p.add_argument("--late-topic", default=_env("LATE_TOPIC", "traffic-late-readings"),
                   help="late readings side output (empty string = off)")
    p.add_argument("--topic-prefix", default=_env("TOPIC_PREFIX", ""),
                   help="prepended to every topic name, e.g. dev- for the fake feed")
    p.add_argument("--offset", choices=["earliest", "latest"], default=_env("OFFSET", "latest"),
                   help="where to start reading the topics when the bridge starts")
    p.add_argument("--host", default=_env("HOST", "0.0.0.0"))
    p.add_argument("--port", type=int, default=int(_env("PORT", "8000")))
    p.add_argument("--links-geojson", type=Path,
                   default=Path(_env("LINKS_GEOJSON", str(REPO_ROOT / "data" / "links.geojson"))))
    p.add_argument("--web-dist", type=Path,
                   default=Path(_env("WEB_DIST", str(REPO_ROOT / "dashboard" / "web" / "dist"))),
                   help="built React app to serve (production mode)")
    p.add_argument("--history-hours", type=float, default=float(_env("HISTORY_HOURS", "168")),
                   help="how much event time the dashboard can travel back over")
    a = p.parse_args(argv)
    return Config(
        bootstrap=a.bootstrap,
        link_stats_topic=a.link_stats_topic,
        borough_stats_topic=a.borough_stats_topic,
        incidents_topic=a.incidents_topic,
        readings_topic=a.readings_topic,
        late_topic=a.late_topic,
        topic_prefix=a.topic_prefix,
        offset=a.offset,
        host=a.host,
        port=a.port,
        links_geojson=a.links_geojson,
        web_dist=a.web_dist,
        history_hours=a.history_hours,
    )

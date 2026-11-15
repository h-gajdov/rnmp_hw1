FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY download_data.py replay.py producer.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Data lives on a mounted volume; it is downloaded on first start if missing.
ENV INPUT=/data/traffic.csv \
    KAFKA_BOOTSTRAP=kafka:9093 \
    PYTHONUNBUFFERED=1
VOLUME /data

ENTRYPOINT ["./entrypoint.sh"]

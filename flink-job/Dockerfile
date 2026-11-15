# Stage 1: build the fat jar with Maven and JDK 17
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests

# Stage 2: the Flink image with our jar in usrlib
FROM flink:2.3.0-java17
COPY --from=build /build/target/traffic-flink-job-1.0.jar /opt/flink/usrlib/traffic-job.jar
COPY --chmod=755 submit-job.sh /opt/flink/bin/submit-job.sh

# Default: submit the job to the session cluster at $JOBMANAGER and exit.
# Program arguments are the container command, e.g. ["--bootstrap", "kafka:9093", "--offset", "earliest"].
ENV JOBMANAGER=jobmanager:8081
ENTRYPOINT ["/opt/flink/bin/submit-job.sh"]
CMD ["--bootstrap", "kafka:9093"]

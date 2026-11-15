# Dashboard image: builds the React app, then runs the Python bridge which
# serves the built UI + Socket.IO + /api on one port (8000).
# Build context is the dashboard/ directory:  docker build -t traffic-dashboard dashboard

# ---- 1. build the React app ----
FROM node:22-slim AS web
WORKDIR /app/dashboard/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2. run the bridge ----
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1
WORKDIR /app/dashboard/server
COPY server/pyproject.toml server/uv.lock server/.python-version ./
RUN uv sync --frozen --no-dev
COPY server/ ./
COPY --from=web /app/dashboard/web/dist /app/dashboard/web/dist

# Defaults for the course Docker network; every one can be overridden.
ENV KAFKA_BOOTSTRAP=kafka:9093 \
    LINKS_GEOJSON=/data/links.geojson \
    WEB_DIST=/app/dashboard/web/dist \
    OFFSET=latest \
    PORT=8000
EXPOSE 8000
CMD ["/app/dashboard/server/.venv/bin/python", "-m", "bridge"]

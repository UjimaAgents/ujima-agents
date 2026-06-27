# syntax=docker/dockerfile:1
#
# Ujima Agents — multi-arch Docker image
#
# Build args:
#   UJIMA_VERSION   version tag (e.g. 0.0.51)
#
# The platform tarball must be in docker-build/ujima-*.tar.gz
# (downloaded by the release workflow before this step).

ARG UJIMA_VERSION

# ── Stage 1: Extract tarball ───────────────────────────────────────────
FROM scratch AS tarball
COPY docker-build/ujima-*.tar.gz /tmp/ujima.tar.gz

# ── Stage 2: Runtime image ─────────────────────────────────────────────
FROM debian:bookworm-slim

ARG UJIMA_VERSION

LABEL org.opencontainers.image.title="Ujima Agents"
LABEL org.opencontainers.image.description="Framework for building Slack-like teams of AI agents"
LABEL org.opencontainers.image.version="${UJIMA_VERSION}"
LABEL org.opencontainers.image.source="https://github.com/UjimaAgents/ujima-agents"
LABEL org.opencontainers.image.licenses="MIT"

# Install runtime dependencies (glibc, ca-certificates for HTTPS)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Copy and extract the platform tarball
COPY --from=tarball /tmp/ujima.tar.gz /tmp/
RUN tar xzf /tmp/ujima.tar.gz -C /opt && \
    rm /tmp/ujima.tar.gz && \
    ln -s /opt/ujima/ujima /usr/local/bin/ujima

# Expose default ports
# API server
EXPOSE 3001
# Web UI
EXPOSE 3000

WORKDIR /opt/ujima

ENTRYPOINT ["ujima"]
CMD ["start"]

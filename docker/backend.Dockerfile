# docker/backend.Dockerfile
#
# Multi-stage build:
#   Stage 1 (builder) — installs Go + all Go recon tools
#   Stage 2 (runtime) — Python 3.13 slim, non-root recon user
#
# MAINTENANCE: Pin Go version to the latest stable release.
# Check https://go.dev/dl/ — update the URL below when a new version ships.
# Current pin: go1.24.2 linux/amd64  (update as needed)
# Architecture: amd64 (ThinkCentre M725s)

# ---- Stage 1: Build Go tools ----
FROM python:3.13-slim-bookworm AS builder

# ── Go recon tool versions ─────────────────────────────────────────────────
# Pinned to specific releases for reproducible builds.
# To update a tool: change the version below, then rebuild with
#   docker compose build --no-cache backend
# Verify latest releases at https://github.com/ORG/TOOL/releases
ARG AMASS_VERSION=v4.2.0
ARG SUBFINDER_VERSION=v2.13.0
ARG HTTPX_VERSION=v1.9.0
ARG NUCLEI_VERSION=v3.8.0
ARG NAABU_VERSION=v2.5.0
ARG KATANA_VERSION=v1.5.0
ARG ALTERX_VERSION=v0.1.0
ARG TLSX_VERSION=v1.2.2
ARG PUREDNS_VERSION=v2.1.1
ARG ASSETFINDER_VERSION=v0.1.1
ARG GAU_VERSION=v2.2.4
ARG GOWITNESS_VERSION=df54b384f4161a4fa2407238cc73ff6773b559b1  # tag 3.1.1 — no v-prefix tag exists
ARG ZGRAB2_VERSION=v1.0.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git build-essential ca-certificates libpcap-dev \
    && rm -rf /var/lib/apt/lists/*

ENV GOPATH=/root/go
ENV PATH=$PATH:/usr/local/go/bin:$GOPATH/bin

RUN curl -sL https://go.dev/dl/go1.24.2.linux-amd64.tar.gz \
    | tar -C /usr/local -xz

# Install all Go recon tools at pinned versions
RUN go install github.com/owasp-amass/amass/v4/...@${AMASS_VERSION}                          \
    && go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@${SUBFINDER_VERSION} \
    && go install github.com/projectdiscovery/httpx/cmd/httpx@${HTTPX_VERSION}               \
    && go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@${NUCLEI_VERSION}         \
    && go install github.com/projectdiscovery/naabu/v2/cmd/naabu@${NAABU_VERSION}           \
    && go install github.com/projectdiscovery/katana/cmd/katana@${KATANA_VERSION}             \
    && go install github.com/projectdiscovery/alterx/cmd/alterx@${ALTERX_VERSION}             \
    && go install github.com/projectdiscovery/tlsx/cmd/tlsx@${TLSX_VERSION}                   \
    && go install github.com/d3mondev/puredns/v2@${PUREDNS_VERSION}                           \
    && go install github.com/tomnomnom/assetfinder@${ASSETFINDER_VERSION}                     \
    && go install github.com/lc/gau/v2/cmd/gau@${GAU_VERSION}                               \
    && go install github.com/sensepost/gowitness@${GOWITNESS_VERSION}                         \
    && go install github.com/zmap/zgrab2/cmd/zgrab2@${ZGRAB2_VERSION}

# massdns — required by puredns for mass DNS resolution
RUN git clone --depth 1 https://github.com/blechschmidt/massdns.git /tmp/massdns \
    && cd /tmp/massdns && make && make install && rm -rf /tmp/massdns


# ---- Stage 2: Runtime image ----
FROM python:3.13-slim-bookworm

# Runtime system deps:
# - chromium: for gowitness screenshots
# - curl: healthcheck + resolver updates
# - jq: JSON processing in scripts
# - ruby: for CeWL
# - libpcap-dev: required by naabu
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium curl git jq ruby ruby-dev libpcap-dev ca-certificates \
    build-essential libxml2-dev libxslt-dev zlib1g-dev \
    nmap \
    && rm -rf /var/lib/apt/lists/*

# Ruby tools — CeWL is not on RubyGems, must install from source (optional — graceful on DNS failure)
RUN git clone --depth 1 https://github.com/digininja/CeWL.git /opt/cewl \
    && cd /opt/cewl \
    && gem install bundler --no-document \
    && bundle install --jobs=4 \
    && printf '#!/bin/sh\nruby /opt/cewl/cewl.rb "$@"\n' > /usr/local/bin/cewl \
    && chmod +x /usr/local/bin/cewl \
    || echo "WARNING: CeWL install failed (DNS/network issue) — tool unavailable at runtime"

# Python dependencies — installed BEFORE Go binaries to prevent pip's httpx CLI
# stub from overwriting the Go-based ProjectDiscovery httpx at /usr/local/bin/httpx.
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Phase 7: Optional tools — WAF detection, S3 scanning (PyPI)
RUN pip install --no-cache-dir wafw00f s3scanner

# Phase 7: cloud_enum — not on PyPI, install from GitHub (optional — graceful on DNS failure)
# pip install doesn't bundle enum_tools/fuzz.txt, so fetch it separately
RUN pip install --no-cache-dir git+https://github.com/initstring/cloud_enum.git \
    || (git clone --depth 1 https://github.com/initstring/cloud_enum /opt/cloud_enum \
        && pip install --no-cache-dir -r /opt/cloud_enum/requirements.txt \
        && printf '#!/bin/sh\npython3 /opt/cloud_enum/cloud_enum.py "$@"\n' > /usr/local/bin/cloud_enum \
        && chmod +x /usr/local/bin/cloud_enum) \
    || echo "WARNING: cloud_enum install failed (DNS/network issue) — tool unavailable at runtime"
RUN python3 -c "import enum_tools, pathlib; p=pathlib.Path(enum_tools.__file__).parent" 2>/dev/null \
    && SITE=$(python3 -c "import enum_tools, pathlib; print(pathlib.Path(enum_tools.__file__).parent)") \
    && curl -fsSL https://raw.githubusercontent.com/initstring/cloud_enum/master/enum_tools/fuzz.txt \
       -o "$SITE/fuzz.txt" \
    || echo "WARNING: cloud_enum fuzz.txt fetch failed — mutations disabled at runtime"

# Phase 6: SubDomainizer — JS subdomain extraction (no PyPI package, clone + wrap)
# Fixes for Python 3.13:
#   - htmlmin broken (cgi module removed) → replace with htmlmin2
#   - urllib3/requests pinned too old → upgrade after install
# Optional — graceful on DNS failure
RUN git clone --depth 1 https://github.com/nsonaniya2010/SubDomainizer.git /opt/subdomainizer \
    && sed -i 's/^htmlmin.*/htmlmin2/' /opt/subdomainizer/requirements.txt \
    && pip install --no-cache-dir -r /opt/subdomainizer/requirements.txt \
    && pip install --no-cache-dir --upgrade requests urllib3 \
    && printf '#!/bin/sh\npython3 /opt/subdomainizer/SubDomainizer.py "$@"\n' > /usr/local/bin/SubDomainizer \
    && chmod +x /usr/local/bin/SubDomainizer \
    || echo "WARNING: SubDomainizer install failed (DNS/network issue) — tool unavailable at runtime"

# Copy Go binaries from builder — runs AFTER pip so Go httpx overwrites Python's stub.
COPY --from=builder /root/go/bin/* /usr/local/bin/
COPY --from=builder /usr/local/bin/massdns /usr/local/bin/massdns

# NOTE: nuclei templates are intentionally NOT updated at image build time.
# Fetching templates at build time makes the build non-reproducible and pulls
# untrusted content without integrity verification.
# Update templates at runtime: docker exec recon-backend nuclei -update-templates

# Non-root user
RUN useradd -r -s /bin/false -m -d /home/recon recon \
    && touch /home/recon/.gau.toml \
    && mkdir -p /home/recon/.config /home/recon/.cache \
    && chown -R recon:recon /home/recon

# App code
COPY engine/     /app/engine/
COPY migrations/ /app/migrations/
COPY scripts/    /app/scripts/

# Wordlist build (downloads at image build time — see WORDLISTS.md)
RUN bash /app/scripts/build-wordlists.sh

# Data directories (runtime volume will be mounted over /data)
RUN mkdir -p /data/scans /data/screenshots /data/logs /data/backups \
             /data/tool-configs/subfinder /data/tool-configs/amass \
             /data/tool-configs/httpx /data/tool-configs/nuclei \
             /data/tool-configs/naabu /data/tool-configs/katana \
             /data/wordlists/custom /data/resolvers \
    && chown -R recon:recon /data /app

WORKDIR /app
USER recon

EXPOSE 8000

# Production: 1 Uvicorn worker under Gunicorn.
# 1 worker is intentional — WebSocket events share in-process state;
# multiple workers would isolate WS connections from scan events.
# --timeout 1800: this worker also HOSTS the scan pipeline in-process
# (amass alone runs ~10 min). The default 30s worker-heartbeat timeout was
# SIGKILLing the worker whenever a synchronous step stalled the event loop
# >30s; the respawned worker's crash-recovery then mislabeled the in-flight
# amass step as failed. 1800s tolerates any legitimate stall while still
# catching a genuinely wedged worker.
CMD ["gunicorn", "engine.app:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "1", \
     "--timeout", "1800", \
     "--max-requests", "0", \
     "--graceful-timeout", "300", \
     "--preload"]

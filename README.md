# RECON_FRAMEWORK

> **⚠️ Work in Progress** — RECON_APP is under active development. Core functionality works and the app is usable, but expect rough edges, missing features, and breaking changes between versions. Not recommended for production use without review. Contributions and feedback welcome.

An automated domain reconnaissance platform for security professionals, bug bounty hunters, and penetration testers. RECON_APP orchestrates 20+ industry-standard recon tools in a configurable pipeline, stores results in SQLite, and provides a responsive React dashboard with real-time updates.

## ✨ Features

- **Multi-source passive enumeration**: Subfinder, Amass, Assetfinder, CRT.sh, Gau, TLSx, Shodan integration
- **Active probing**: HTTPx (multi-round probing with port variation), Naabu port scanning, Zgrab2 service identification
- **DNS operations**: PureDNS (brute-force, permutation), Alterx patterns, wildcard detection
- **Advanced techniques**: JavaScript crawling (Katana, Subdomainizer), Nuclei takeover detection, S3 bucket discovery, WAF detection
- **Visual reconnaissance**: Gowitness screenshots with responsive rendering
- **Change tracking**: Diff engine detects discovered/changed/gone/returned hosts across scans
- **Notifications**: Telegram bot, Discord/Slack webhooks, in-app notification feed
- **Data export**: CSV, JSON, and Markdown formats for all major result types
- **Scheduling**: Repeating scan templates with configurable execution intervals
- **Scope management**: CIDR/domain rules with out-of-scope filtering
- **Batch operations**: Bulk target management, multi-scan execution
- **Real-time updates**: WebSocket-based dashboard with live scan progress

## 📸 Screenshots

### 1) Dashboard Overview

<img width="2520" height="1307" alt="Screenshot from 2026-04-27 02-44-36" src="https://github.com/user-attachments/assets/de96f5a2-aaf4-4c09-81c8-dcedc9a48705" />

### 2) Active Scan Pipeline

<img width="2520" height="1307" alt="Screenshot from 2026-04-27 02-40-09" src="https://github.com/user-attachments/assets/746c1b1b-288d-4ab2-be07-34249c8c83f6" />

### 3) Live Hosts Results

<img width="2520" height="1307" alt="Screenshot from 2026-04-27 02-44-55" src="https://github.com/user-attachments/assets/23133f8a-a149-4f72-9d4e-1b8aed6f67f4" />

### 4) Screenshot Gallery

<img width="2520" height="1307" alt="Screenshot from 2026-04-27 02-49-46" src="https://github.com/user-attachments/assets/23043e48-8c52-4c00-9c39-350ed02d52b3" />

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- 4GB+ RAM, 2+ CPU cores
- Preferably Linux (macOS/Windows supported via Docker Desktop)

### Start the Application

```bash
# Clone and navigate
git clone <repo-url>
cd RECON_APP

# Copy example env and update with your settings
cp .env.example .env
# Edit .env: set RECON_MASTER_KEY and ENCRYPTION_SALT

# Start services
docker compose up -d

# Verify health
curl http://localhost:8080/api/v1/health

# Open dashboard
open http://localhost:8080
```

The dashboard runs on `http://localhost:8080`. Backend API is at `http://localhost:8080/api/v1`.

**Deploying on a remote server?** Two extra steps in `docker-compose.yml`:
```yaml
environment:
  - ALLOWED_ORIGINS=["http://YOUR_SERVER_IP:8080"]
  - TRUSTED_HOSTS=["YOUR_SERVER_IP","YOUR_SERVER_IP:8080"]
```
Without these, the backend will reject requests from non-localhost origins. See [Deployment Guide](../../wiki/Deployment) for full instructions including HTTPS setup.

### Configuration

Required variables in `.env`:
- `RECON_MASTER_KEY` — 32-byte random string for encrypting API keys at rest
- `ENCRYPTION_SALT` — 16-byte random string for key derivation

Optional in `docker-compose.yml` environment block:
- `LOG_LEVEL` — `INFO`, `DEBUG`, or `WARNING` (default: `INFO`)
- `DATA_DIR` — Volume mount path (default: `/data`)
- `ALLOWED_ORIGINS` — JSON list of allowed origins (default: `["http://localhost:8080"]`)
- `TRUSTED_HOSTS` — JSON list of trusted Host header values

Tool-specific API keys are configured in the **Settings > API Keys** tab:
- Shodan, SecurityTrails, Hunter.io, Censys, etc.
- All encrypted with RECON_MASTER_KEY before storage

## 📚 Documentation

- **[Getting Started](../../wiki/Getting-Started)** — Installation, configuration, first scan
- **[Architecture](../../wiki/Architecture)** — System design, data flow, component overview
- **[API Reference](../../wiki/API-Reference)** — Endpoint documentation, schemas, error handling
- **[Pipeline System](../../wiki/Pipeline-System)** — Tool execution, orchestration, templating
- **[Adding a New Tool](../../wiki/Adding-a-New-Tool)** — Pipeline integration guide: pre-coding decisions, BaseTool/BaseAction, DB migration, full walkthrough
- **[Deployment](../../wiki/Deployment)** — Production setup, Docker optimization, scaling
- **[Contributing](CONTRIBUTING.md)** — Development workflow, code standards, PR guide

## 🏗️ Project Structure

```
RECON_APP/
├── engine/                    # Backend (Python/FastAPI)
│   ├── api/                   # 14 routers (targets, scans, pipeline, etc.)
│   ├── pipeline/              # Execution engine + step registry
│   ├── tools/                 # Tool implementations (subprocesses + actions)
│   ├── db.py                  # SQLite async wrapper
│   ├── notifier.py            # Telegram/webhook dispatcher
│   └── scheduler.py           # Scan orchestration
├── frontend/                  # React/TypeScript/Vite
│   ├── src/
│   │   ├── pages/             # 5 main pages
│   │   ├── components/        # Data tables, charts, forms
│   │   ├── hooks/             # useApi, useWebSocket, etc.
│   │   └── lib/               # Themes, utilities
│   └── vite.config.ts
├── migrations/                # Numbered SQL schema files (001–015)
├── docker/                    # Dockerfiles + nginx config
├── docker-compose.yml
├── .env.example               # Environment variable template
├── CONTRIBUTING.md
├── CHANGELOG.md
└── LICENSE
```

## 🎯 Common Tasks

### Add a Target and Run a Scan
1. Go to Dashboard → "Create Target"
2. Enter domain, select template (Standard/Minimal/SaaS)
3. Configure scope rules if needed (target-specific inclusion/exclusion)
4. Click "Start Scan" on the target card
5. Monitor progress in real-time via Dashboard or Target Detail page

### Export Results
1. Navigate to Target Detail
2. Choose result type: Subdomains, Hosts, Ports, Takeovers, Diff, etc.
3. Click **Export** button → CSV/JSON/Markdown

### Configure Telegram Notifications
1. Settings → Telegram tab
2. Create Telegram bot: [@BotFather](https://t.me/botfather)
3. Paste bot token and chat ID
4. Test button validates connection
5. Scans now notify to Telegram when new hosts are discovered

### Set Up Scheduled Reports
1. Settings → Reports tab
2. Create schedule: target, frequency (daily/weekly), recipients
3. Reports auto-send to Telegram on schedule

### Add Custom Wordlists
1. Settings → Wordlists tab
2. Upload custom `.txt` files (one domain per line)
3. Select when configuring DNS brute-force steps

## 🧪 Testing

```bash
# Run backend tests
docker exec recon-backend pytest tests/

# Run frontend tests (in development)
cd frontend && npm test

# Check health endpoint
curl http://localhost:8080/api/v1/health | jq .

# Watch backend logs
docker compose logs -f backend
```

## 📈 Performance Tuning

- **Concurrent scans**: Scheduler enforces one active scan at a time (prevent resource thrashing)
- **Worker count**: 1 Gunicorn worker (intentional — WebSocket scan events use in-process state; multiple workers would isolate WS connections from scan updates)
- **Database**: WAL mode enabled, 64 MB cache, `secure_delete=ON`, foreign key enforcement
- **Compression**: gzip enabled in nginx for API responses > 1KB

## 🐛 Debugging

### Check Application Health
```bash
# Backend logs
docker compose logs backend | tail -50

# Frontend logs (browser console)
# Open DevTools (F12) → Console tab

# Database integrity
docker exec recon-backend sqlite3 /data/recon.db "PRAGMA integrity_check;"
```

### Common Issues

| Issue | Solution |
|-------|----------|
| "Cannot connect to backend" | Check `docker compose logs backend` for startup errors |
| Scans hung | Check `/data/logs/engine.log` for tool subprocess timeouts |
| Out of memory | Increase Docker memory limit in `docker-compose.yml` |
| WebSocket disconnects | Verify origin in CORS settings; check nginx logs |

## 🤝 Contributing

Bug reports, feature requests, and pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup
- Code style (type hints + parameterized SQL for Python; ESLint + strict TypeScript)
- Security rules

For adding a new pipeline tool end-to-end, see the **[Adding a New Tool](../../wiki/Adding-a-New-Tool)** wiki page.

## 📝 License

[MIT](LICENSE)

---

**Last updated**: April 2026  
**Status**: Active development — functional but not production-hardened

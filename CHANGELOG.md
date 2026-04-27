# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-04-27

### Added
- Full automated recon pipeline with 37 steps across 15 groups
- 20+ integrated tools: subfinder, amass, httpx, nuclei, naabu, katana, gowitness, puredns, alterx, tlsx, gau, assetfinder, zgrab2, nmap, SubDomainizer, CeWL, cloud_enum, s3scanner, wafw00f
- React 19 dashboard with real-time WebSocket updates
- 5 frontend pages: Dashboard, Target Detail, Pipeline Editor, Settings, 404
- 10 settings tabs: General, Telegram, API Keys, Tools, Templates, Wordlists, Webhooks, Reports, Storage, Appearance
- 4 UI themes with dark/light mode: neon-recon, eslinks, resolve-ai, claude
- Diff engine tracking live_hosts changes across scans (discovered/changed/gone/returned)
- In-app notification feed + Telegram Bot + Discord/Slack/generic webhook delivery
- Scheduled report delivery
- CSV/JSON export for 8 data types
- Global search across targets, subdomains, hosts
- Scope rules engine per target
- Pipeline template system with CRUD
- Wordlist management with custom uploads
- Server-side pagination on all large datasets
- Keyboard shortcuts throughout the UI
- Bulk operations on targets and scan sessions
- 13 Recharts-based dashboard chart components
- SQLite WAL mode with automatic migrations (001–015)
- Fernet encryption at rest for all API keys and secrets
- Docker Compose deployment: multi-stage builds, non-root user, read-only filesystem, cap_drop ALL
- SSRF protection on all outbound webhook URLs
- Rate limiting via nginx + SlowAPI

[1.0.0]: https://github.com/Kyrielles/RECON_APP/releases/tag/v1.0.0

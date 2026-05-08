# AI K6 Automation Platform

An AI-powered load test automation platform. Upload test cases in plain English or Excel, let Claude AI extract API endpoints and generate production-ready K6 scripts, then execute them with real-time streaming output into Grafana.

## Architecture

```
┌─────────────────────────────────────────┐
│           Browser (Single Page App)      │
│  Upload → Analyze → Script → Execute     │
└────────────────┬────────────────────────┘
                 │ HTTP / SSE
┌────────────────▼────────────────────────┐
│          Node.js Express Backend         │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ File     │  │ Claude   │  │  K6    │ │
│  │ Parser   │  │ AI Svc   │  │ Runner │ │
│  │xlsx/txt  │  │Anthropic │  │Docker  │ │
│  └──────────┘  └──────────┘  └────────┘ │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│              Docker Compose              │
│  InfluxDB (metrics) ← K6 → Grafana      │
└─────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- An Anthropic API key

### 1. Clone and configure
```bash
git clone <repo-url>
cd QA-K6-automation
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 2. Start the platform
```bash
docker-compose up -d
```

| Service | URL |
|---------|-----|
| Platform UI | http://localhost:3000 |
| Grafana Dashboard | http://localhost:3001 |
| InfluxDB | http://localhost:8086 |

### 3. Development (without Docker)
```bash
npm install
cp .env.example .env
# Edit .env with your API key
# Set INFLUXDB_URL= (empty to skip metrics)
npm run dev
```

## Usage

### Step 1 — Upload Test Cases
Upload a file or paste test cases in plain English:
- `.txt` — natural language test descriptions
- `.xlsx` / `.csv` — spreadsheet with test case rows
- `.json` — structured test case JSON

**Example:**
```
Test login API:
- POST /api/auth/login with { email, password }
- Expect 200 OK with JWT token
- 50 virtual users, 2 minute duration
```

### Step 2 — AI Analysis
Claude AI parses your test cases and extracts:
- HTTP method, URL, headers, body
- Expected status codes and assertions
- Load profiles (VUs, duration, ramp-up)
- Flags inferred/missing fields

### Step 3 — Script Generation
Claude generates a complete K6 JavaScript script with:
- Proper imports (`k6/http`, `k6`, `k6/metrics`)
- `export const options` with scenarios and thresholds
- `checks()` for each assertion
- Custom `Trend` metrics
- `handleSummary()` for reports
- `__ENV.BASE_URL` support for overrides

### Step 4 — Execute
Run the script directly from the UI. Live logs stream back via SSE. After completion:
- View detailed metrics in Grafana
- Check pass/fail status
- Review run history

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | **Required.** Claude API key |
| `PORT` | `3000` | Backend server port |
| `INFLUXDB_URL` | `http://influxdb:8086` | InfluxDB for K6 metrics |
| `INFLUXDB_DB` | `k6` | InfluxDB database name |
| `K6_DOCKER_IMAGE` | `grafana/k6:latest` | K6 Docker image |
| `SCRIPTS_DIR` | `./scripts/generated` | Where to store generated scripts |

## Project Structure

```
├── src/
│   ├── server.js              # Express entry point
│   ├── routes/
│   │   ├── upload.js          # POST /api/upload
│   │   ├── analyze.js         # POST /api/analyze, /api/analyze/generate
│   │   ├── scripts.js         # CRUD /api/scripts
│   │   └── execute.js         # POST /api/execute, SSE stream
│   ├── services/
│   │   ├── aiService.js       # Claude API integration
│   │   ├── k6Runner.js        # Docker K6 execution
│   │   ├── fileParser.js      # xlsx/csv/txt parsing
│   │   └── scriptStore.js     # Script persistence
│   └── utils/logger.js
├── public/                    # Frontend SPA
├── grafana/                   # Grafana provisioning
├── examples/                  # Sample test case files
├── docker-compose.yml
└── Dockerfile
```

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload test case file |
| POST | `/api/analyze` | Extract test cases via AI |
| POST | `/api/analyze/generate` | Generate K6 script (SSE stream) |
| GET | `/api/scripts` | List saved scripts |
| GET | `/api/scripts/:id` | Get script content |
| PUT | `/api/scripts/:id` | Update script content |
| DELETE | `/api/scripts/:id` | Delete script |
| POST | `/api/execute` | Start K6 run |
| GET | `/api/execute` | List all runs |
| GET | `/api/execute/:runId` | Get run details |
| GET | `/api/execute/:runId/stream` | SSE live log stream |

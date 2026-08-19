# OpenCellID LBS Service

HTTP service for resolving mobile cell tower coordinates from [OpenCellID](https://opencellid.org/) CSV data using LBS identifiers (MCC, MNC, LAC/TAC, CID).

The service reads a pre-built binary index file (`.idx`) at startup — it does **not** parse the full CSV on each run. Index building streams the CSV row-by-row and uses external sort, so large datasets can be processed with bounded memory.

## Features

- Lookup coordinates by cell tower identifiers (MCC, MNC, LAC, CID)
- Multi-cell weighted average location (`/locate/multilaterate`)
- Streaming index builder for large OpenCellID CSV files
- Low-memory runtime: binary search on disk-backed index
- Docker support

## Quick start

### Docker (recommended)

```bash
docker compose up --build
```

The container starts with the bundled sample index. Test it:

```bash
curl "http://localhost:3000/locate?mcc=260&mnc=2&lac=45080&cid=21728"
```

### Local

```bash
npm install
npm run build-index -- data/sample_cell_towers.csv data/sample_cell_towers.idx
npm start
```

Set `INDEX_PATH` in `.env` if your index is elsewhere (see `.env.example`).

## Index build (one-time)

Place your OpenCellID CSV (e.g. `cell_towers.csv`) in `data/`, then:

```bash
npm run build-index -- data/cell_towers.csv data/cell_towers.idx
```

Or with Docker:

```bash
# Put cell_towers.csv into ./data/
docker compose --profile tools run --rm build-index
```

Tune memory during build via `BUILD_CHUNK_RECORDS` (default `250000`, ~8 MB per sort chunk):

```env
BUILD_CHUNK_RECORDS=100000
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health and index stats |
| `GET` | `/stats` | Index file stats |
| `GET` | `/locate?mcc=&mnc=&lac=&cid=` | Single-cell lookup |
| `POST` | `/locate` | Single-cell lookup (JSON body) |
| `POST` | `/locate/multilaterate` | Multi-cell weighted average |

### Single cell

```bash
curl "http://localhost:3000/locate?mcc=260&mnc=2&lac=45080&cid=21728"
```

```json
{
  "query": { "mcc": 260, "mnc": 2, "lac": 45080, "cid": 21728 },
  "location": { "lat": 52.275505, "lon": 21.016382, "accuracyMeters": 123 },
  "tower": { "mcc": 260, "mnc": 2, "lac": 45080, "cid": 21728, "lat": 52.275505, "lon": 21.016382, "range": 123, "samples": 2 }
}
```

### Multiple cells

```bash
curl -X POST http://localhost:3000/locate/multilaterate \
  -H "Content-Type: application/json" \
  -d '{
    "cells": [
      { "mcc": 260, "mnc": 2, "lac": 45080, "cid": 21728 },
      { "mcc": 260, "mnc": 2, "lac": 58140, "cid": 42042781 }
    ]
  }'
```

LAC/TAC and CID accept aliases: `tac`, `cellid`, `cell`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `INDEX_PATH` | `./data/sample_cell_towers.idx` | Path to binary index file |
| `CSV_PATH` | — | CSV path for index build |
| `BUILD_CHUNK_RECORDS` | `250000` | Sort chunk size for index build |

## Docker with custom index

1. Build the index locally or via `docker compose --profile tools run --rm build-index`
2. Ensure `data/cell_towers.idx` exists
3. Start the service:

```bash
docker compose up --build
```

The compose file mounts `./data` read-only and sets `INDEX_PATH=/data/cell_towers.idx`.

To use only the sample index inside the image, override the environment:

```bash
INDEX_PATH=/app/data/sample_cell_towers.idx docker compose up --build
```

## Project structure

```
src/
  server.js           # HTTP server
  buildIndex.js       # CSV → .idx index builder
  cellTowerStore.js   # Binary index lookup
  lib/
    csvTowerParser.js # Streaming CSV parser
    externalSort.js   # Disk-based external sort
    towerRecord.js    # Binary record format
  routes/
    locate.js         # /locate endpoints
data/
  sample_cell_towers.csv
  sample_cell_towers.idx   # generated
```

## Data attribution

Cell tower data from [OpenCellID](https://opencellid.org/) is licensed under [CC-BY-SA](https://creativecommons.org/licenses/by-sa/4.0/). Products using this data must credit OpenCellID and link to https://opencellid.org/.

## License

MIT — see [LICENSE](LICENSE).

## Publish to GitHub

```bash
git add .
git commit -m "Initial commit: OpenCellID LBS service"
gh repo create opencellid-lbs-service --public --source=. --remote=origin --push
```

Without GitHub CLI, create a repository on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/opencellid-lbs-service.git
git branch -M main
git push -u origin main
```

After creating the repo, update the `repository` field in `package.json` with your GitHub URL.

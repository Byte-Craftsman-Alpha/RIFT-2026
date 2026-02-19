# Financial Forensics Engine (Money Muling Detection)

A web-based Financial Forensics Engine that ingests a transaction CSV, detects money-muling patterns using graph algorithms, visualizes the directed flow graph, and exports a standardized JSON report.

## MVP features

- **Circular routing (cycles)**
  - Detect directed cycles of length **3 to 5** (e.g., A → B → C → A).
- **Smurfing (fan-in / fan-out)**
  - Detect **aggregators** (10+ distinct senders to 1 receiver) and **dispersers** (1 sender to 10+ distinct receivers) within a **72-hour** window.
- **Layered shell networks**
  - Detect chains of **3+ hops** where intermediate accounts have very low transaction counts (**2–3 total**).
- **Interactive UI**
  - CSV upload
  - Graph visualization with suspicious nodes highlighted
  - Fraud summary table (click to highlight ring members on the graph)
- **JSON export**
  - Download button exports `report` JSON with `suspicious_accounts` and `fraud_rings`.

## Input CSV format

Required columns:

- `transaction_id`
- `sender_id`
- `receiver_id`
- `amount`
- `timestamp`

`timestamp` can be an ISO string (recommended) or a numeric epoch value.

Sample file:

- `public/sample-transactions.csv`

## Local development

```bash
npm install
npm run dev
```

Open:

- http://localhost:3000

## API

### `POST /api/analyze`

Upload the CSV as `multipart/form-data` with field name `file`.

Response:

- `graph.nodes[]`: accounts with suspicion `score` and pattern flags
- `graph.edges[]`: aggregated sender→receiver edges with total `amount` and `count`
- `report.suspicious_accounts[]`: list of accounts with suspicion scores
- `report.fraud_rings[]`: detected rings/chains with pattern type + evidence

## Deployment (Vercel)

- Push this repo to GitHub.
- In Vercel, click **New Project** and import the repo.
- Build command: `npm run build`
- Output: Next.js default

## Hackathon checklist

- **Live URL** (no auth)
- **README** (this file)
- **2–3 minute demo video** showing upload → detections → graph → JSON download

## Notes

- This repo includes heuristic risk scoring and deduping; tune thresholds in `src/lib/analyze.ts` if needed.
- If the evaluator requires a different JSON schema, adjust the `report` object returned by `/api/analyze`.

# RoadWatch AI

**AI-powered public infrastructure monitoring, built with Gemma 4.**

Built for **Hactoberfest '26** | Problem Statement: *AI-Powered Public Infrastructure Monitoring*

> Citizens report road hazards with a photo and GPS. Gemma 4 detects the issue, rates its severity, and ranks reports on a live map so officials fix the most urgent problems first.

**Live demo:** [add your Vercel link here]
**Demo video:** [add link here]

---

## The Problem

Public infrastructure issues such as potholes, damaged roads, broken streetlights, and overflowing drains are often reported late or go unnoticed. This leads to safety risks and inefficient maintenance, and authorities have no quick way to know which problems are the most urgent.

## Our Solution

RoadWatch AI is a web app with two sides:

- **Citizen portal:** take or upload a photo, and the app captures GPS location and street address automatically.
- **Admin portal:** a map dashboard where municipal officials see every report ranked by priority, update repair status, and generate complaint letters.

**Gemma 4** analyzes each photo, classifies the issue, rates its severity, explains the risk, and writes the formal complaint, replacing manual inspection and paperwork.

## How It Works

```
Citizen photo + GPS
        |
        v
   Web App (React)
        |
        v
 Gemma 4 via Gemini API
 (issue type, severity, risk)
        |
        v
 Priority scoring engine
        |
        v
 Admin dashboard (map + ranked list)
        |
        v
 Complaint letter + PDF report
```

1. **Report:** the citizen submits a photo, location, and optional note.
2. **Analyze:** Gemma 4 returns the issue type, confidence, severity (1-10), risk reason, affected group, and recommended action.
3. **Prioritize:** a transparent formula produces a 0-100 priority score.
4. **Act:** officials review the ranked map, change status (Reported, Assigned, Fixed), and generate a complaint.
5. **Export:** reports and complaints download as PDFs.

## Priority Score

The ranking is rule-based on purpose, so every decision is explainable:

```
priority score = severity x 5 + location risk + duplicate bonus
```

| Factor | How it is calculated |
|---|---|
| Severity | Rated 1-10 by Gemma 4 |
| Location risk | Higher when the report is near a critical location (school, hospital, highway) |
| Duplicate bonus | Extra points when others reported the same issue type nearby |

Scores of 70 and above show as red (high), 40-69 as orange, and below 40 as green.

## Features

- Photo-based detection of potholes, damaged roads, broken streetlights, and drain overflows
- Live camera capture with gallery and phone-camera fallbacks
- Automatic GPS location and reverse-geocoded address
- Severity rating with a plain-language risk explanation
- Explainable priority score with a "Why this score?" breakdown
- Interactive map with color-coded markers (Leaflet + OpenStreetMap)
- Separate citizen and admin portals, with admin login
- Editable list of critical locations that boosts priority
- AI-generated complaint letters
- PDF export of individual reports and summaries

## Role of Gemma 4

Gemma 4 (`gemma-4-26b-a4b-it`, accessed through the Gemini API) is the core intelligence of the system:

| Task | What Gemma 4 does |
|---|---|
| Image analysis | Identifies the issue, rates severity, explains the risk |
| Complaint writing | Drafts a formal, ready-to-send letter to the municipal body |

If the primary model is unavailable, the app falls back to `gemini-2.5-flash`. Gemma 4 is open-weight, so a municipality could self-host it in the future.

## Tech Stack

| Layer | Technology |
|---|---|
| AI | Gemma 4 via Gemini API (Google AI Studio) |
| Frontend | React, TypeScript, Tailwind CSS, Vite |
| Map | Leaflet + OpenStreetMap |
| Backend | Vercel serverless functions (Node.js) |
| Geocoding | OpenStreetMap Nominatim |
| PDF | jsPDF (client-side) |
| Storage | Browser localStorage (prototype) |
| Hosting | Vercel |

## Project Structure

```
roadwatch-ai/
|-- api/                    Vercel serverless functions
|   |-- _lib/gemini.ts      Shared Gemma 4 logic
|   |-- analyze.ts          POST /api/analyze
|   |-- generate-complaint.ts   POST /api/generate-complaint
|   `-- health.ts           GET /api/health
|-- src/
|   |-- components/         UI components
|   |-- utils/              Image, PDF, geocoding helpers
|   |-- App.tsx
|   `-- types.ts
|-- server.ts               Local dev server (not used on Vercel)
|-- vercel.json             Vercel configuration
`-- .env.example
```

## Getting Started

### Prerequisites

- Node.js 18 or newer
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

### Run locally

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/roadwatch-ai.git
cd roadwatch-ai

# 2. Install dependencies
npm install

# 3. Add your API key
cp .env.example .env.local
# open .env.local and set GEMINI_API_KEY

# 4. Start the app
npm run dev
```

Open `http://localhost:3000`.

### Deploy to Vercel

1. Push this repository to GitHub.
2. On [vercel.com](https://vercel.com), choose **Add New > Project** and import the repo. Vercel detects Vite automatically.
3. Under **Environment Variables**, add `GEMINI_API_KEY` with your key.
4. Click **Deploy**.
5. Visit `/api/health` on your deployed URL. It should show `"geminiKeyConfigured": true`.

Redeploy after changing environment variables.

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | API key for the Gemini API (required for real Gemma 4 analysis) |

If the key is missing, the app returns a placeholder result so the interface still loads. Always check `/api/health` before a demo.

## Limitations

- Reports are stored in each user's browser, so they are not shared across devices.
- The admin login is a demo-level separation, not production authentication.
- Severity and confidence come from an AI model and need human review before action.
- Gemma models on the Gemini API have low free-tier rate limits.

## Roadmap

- Shared database and real authentication (Firebase)
- Multilingual reporting in Hindi and Marathi, plus voice notes
- Before/after photo verification when a repair is marked fixed
- Estimated repair cost and time
- Admin chat assistant for querying reports
- Bounding boxes drawn on detected problems
- Integration with municipal complaint systems

## Team

| Name | Role |
|---|---|
| [Name] | [Role] |
| [Name] | [Role] |
| [Name] | [Role] |

## Acknowledgements

- [Gemma](https://ai.google.dev/gemma) by Google
- [Leaflet](https://leafletjs.com) and [OpenStreetMap](https://www.openstreetmap.org)
- [Nominatim](https://nominatim.org) for reverse geocoding

## License

[Add your license here, for example MIT]

# Echo — The Knowledge DJ

> Talk to Echo. Share what inspires you. Get a song that teaches you.

Echo is a **multimodal Live Agent** built for the **Google Live Agent Challenge 2026**. Tell Echo your learning goal and share some links — it scrapes, analyses, and transforms your reading list into a personalized AI-generated music track: AI-written verses, a generated album cover, and an original instrumental composed specifically for your content.

**Category: Creative Storyteller** — chaining Gemini Live, Gemini 2.5 Pro, Imagen 4, and Lyria in a 3-agent ADK-style pipeline.

---

## Live Demo

| Interface | How |
|---|---|
| **🎤 Voice (primary)** | Visit `/live` — talk to Echo via your browser mic, no sign-up needed |
| **⌨️ Web form** | Visit `/demo` — enter goal, genre, and URLs directly |
| **📱 Telegram (optional)** | Chat with the bot via `/start` |

---

## How It Works

### Voice Flow (Gemini Live API)

1. **Open `/live`** — Echo greets you via voice (Gemini 2.5 Flash Native Audio)
2. **Tell Echo** your learning goal, preferred music genre, and paste some URLs
3. Gemini calls the `trigger_generation()` tool — the 3-agent pipeline starts
4. Watch real-time SSE progress: Content Analyst → Creative Director → Artist
5. **Result page** — Imagen 4 album cover, Lyria instrumental, AI-written verses

### Web Form Flow (no mic required)

1. Open `/demo` — enter goal, pick a genre chip, paste URLs
2. Pipeline runs identically — redirects to your result page

---

## Multi-Agent Architecture (ADK Pattern)

```
User Voice / Web Form
        │
        ▼
┌─────────────────────────────────────────────┐
│  Gemini Live API (gemini-2.5-flash-native)  │
│  ↳ Real-time bidirectional voice (WebSocket) │
│  ↳ Collects goal + genre + URLs via convo   │
│  ↳ Calls trigger_generation() tool call     │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
╔═════════════════════════════════════════════════╗
║           Echo Multi-Agent Pipeline             ║
║                                                 ║
║  Agent 1: ContentAnalystAgent                   ║
║    └─ Scrapes URLs (YouTube / web / Twitter)    ║
║    └─ Extracts themes + insights (Gemini Flash) ║
║                     │                           ║
║  Agent 2: CreativeDirectorAgent                 ║
║    └─ Writes 16-line learning verses            ║
║    └─ Album art direction + Musical DNA         ║
║    └─ Gemini 2.5 Pro (BPM, mood, key, scale)   ║
║                     │                           ║
║         ┌───────────┴───────────┐               ║
║  Agent 3: ArtistAgent          │  (parallel)   ║
║    └─ Imagen 4 → album cover   │               ║
║    └─ Lyria → 60s instrumental │               ║
║         └───────────┬──────────┘               ║
║                                                 ║
╚═════════════════════╦═══════════════════════════╝
                      ║
                      ▼
         Google Cloud Storage (cover + audio)
                      │
                      ▼
         Result Page ← SSE real-time progress
           Album art · Lyria track · AI verses
```

---

## Google API Chain

| # | API | Role |
|---|-----|------|
| 1 | **Gemini Live** (`gemini-2.5-flash-native-audio-preview`) | Voice conversation + tool calling |
| 2 | **Gemini 2.5 Flash** (`gemini-2.5-flash`) | Content analysis (Agent 1) |
| 3 | **Gemini 2.5 Pro** (`gemini-2.5-pro`) | Creative writing — verses + musical DNA (Agent 2) |
| 4 | **Imagen 4** (`imagen-4.0-generate-001`, Vertex AI) | Album cover generation (Agent 3, parallel) |
| 5 | **Lyria RealTime** (`lyria-realtime-exp`) | 60s instrumental generation (Agent 3, parallel) |
| 6 | **Cloud Firestore** | Session state persistence |
| 7 | **Cloud Storage** | Generated media hosting (audio + images) |
| 8 | **Cloud Run** | Serverless deployment |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20, Express |
| Live voice | Gemini Live API via WebSocket (AI Studio v1alpha) |
| AI — text | Gemini 2.5 Pro / Flash (`@google/genai`) |
| AI — image | Imagen 4 (`imagen-4.0-generate-001`, Vertex AI) |
| AI — music | Lyria RealTime (`lyria-realtime-exp`, AI Studio) |
| Database | Cloud Firestore (session state) |
| Storage | Google Cloud Storage (all generated media) |
| Bot | Telegraf v4 (Telegram webhook, optional) |
| Real-time | WebSocket (`ws`) + Server-Sent Events (SSE) |
| Deployment | `deploy.sh` → Google Cloud Run (one command) |

---

## Project Structure

```
echo/
├── index.js                  # HTTP + WebSocket server entry point
├── server.js                 # Express — all web pages, SSE, /demo route
├── live-session.js           # Gemini Live API WebSocket handler
├── ai_pipeline.js            # Orchestration — Firestore state + agent runner
├── agents/
│   ├── index.js              # Multi-agent DAG orchestrator + pipelineEvents
│   ├── content_analyst.js    # Scrapes + analyses source content
│   ├── creative_director.js  # Gemini 2.5 Pro verses + art direction
│   └── artist.js             # Imagen 4 + Lyria RealTime (parallel)
├── bot.js                    # Telegram bot (optional interface)
├── db.js                     # Firestore helpers
├── scraper.js                # YouTube / Twitter / web content extraction
├── test/
│   └── pipeline.test.js      # 30 unit tests (jest)
├── assets/
│   ├── echo_logo.jpg
│   └── Immutable_Code.mp3    # Fallback track if Lyria unavailable
├── deploy.sh                 # One-command Cloud Run deployment
├── Dockerfile
├── .env.example
└── package.json
```

---

## Setup & Spin-Up

### Prerequisites

- Node.js ≥ 20
- Google Cloud project with **billing enabled**
- APIs enabled: **Vertex AI API**, **Cloud Firestore API**, **Cloud Storage API**
- Gemini API key — [get one free at AI Studio](https://aistudio.google.com/app/apikey)
- GCP Application Default Credentials: `gcloud auth application-default login`

### Run Locally (5 minutes)

```bash
# 1. Clone and install
git clone <your-repo-url>
cd echo
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — fill in at minimum:
#   GEMINI_API_KEY=...
#   GOOGLE_CLOUD_PROJECT=your-gcp-project-id
#   GCS_BUCKET=your-gcp-project-id-echo-media

# 3. Start dev server
npm run dev

# 4. Open in browser
open http://localhost:8080/demo    # Web form — no mic needed
open http://localhost:8080/live    # Voice interface
```

> Firestore and GCS are accessed via Application Default Credentials.
> On first run, the GCS bucket is created automatically.

### Run Tests

```bash
npm test
# → 30 unit tests, all pass
```

---

## Deploy to Google Cloud Run

```bash
# One-command deployment (requires gcloud CLI authenticated)
cp .env.example .env  # fill in secrets
./deploy.sh
```

`deploy.sh` uses `gcloud run deploy --source .` for automated Cloud Build + Cloud Run deployment. No manual Docker steps required. Update the `PROJECT_ID`, `REGION`, and `CLOUD_RUN_URL` variables at the top of `deploy.sh` for your own project.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Gemini API key — Gemini Live + Lyria + text generation |
| `GOOGLE_CLOUD_PROJECT` | ✅ | GCP project ID |
| `GOOGLE_CLOUD_REGION` | ✅ | Vertex AI region (default: `us-central1`) |
| `GCS_BUCKET` | ✅ | GCS bucket for generated media |
| `CLOUD_RUN_URL` | ✅ | Public URL of deployed service (for Telegram webhook) |
| `TELEGRAM_BOT_TOKEN` | Optional | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Optional | Bot username without `@` |
| `PORT` | Optional | Server port (default: `8080`) |

---

## Web Pages

| Route | Description |
|---|---|
| `/` | Landing page |
| `/live` | Voice session with Gemini Live API |
| `/demo` | Web form — enter goal, genre, and links (no Telegram required) |
| `/digest/:chat_id` | Dashboard / Processing / Result (auto-switches by status) |
| `/api/pipeline-status/:chat_id` | SSE stream of real-time agent progress |

---

## Graceful Degradation

| Failure | Fallback |
|---|---|
| Lyria unavailable / timeout | Uploads bundled `Immutable_Code.mp3` to GCS |
| Imagen 4 fails | Uses Echo logo as album cover |
| Gemini 2.5 Pro quota exceeded | Falls back to Gemini 2.5 Flash |
| Microphone denied | Use the `/demo` web form instead |
| Pipeline errors | Session status set to `error`, dedicated error page with retry |

---

## License

MIT — Echo Team, 2026

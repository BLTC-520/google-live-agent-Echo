# Echo — The Knowledge DJ

> Talk to Echo. Share what inspires you. Get a song that teaches you.

Echo is a **multimodal AI agent** built for the **Google Live Agent Challenge 2026**. Tell Echo what you're learning, share some links, and it transforms your reading list into a personalized AI-generated music track — complete with lyrics, an AI-generated album cover, and a full music track.

**Category: Creative Storyteller** — blending voice, text, images, and audio into one seamless experience.

---

## Live Demo

| Interface | How |
|---|---|
| **🎤 Voice (primary)** | Visit `/live` — talk to Echo directly using your browser mic |
| **📱 Telegram (backup)** | Chat with the bot via `/start` |

---

## How It Works

### Voice Flow (Gemini Live API)

1. **Open `/live`** — Echo greets you via voice
2. **Tell Echo** your learning goal, preferred genre, and paste some links
3. **Echo generates** your track and redirects you to the result page
4. **Listen** — lyrics, album cover, and audio player, all in one page

### Telegram Flow

1. `/start` → set goal and genre
2. Paste links → `/generate_digest`
3. Echo sends you the result URL

---

## Multi-Agent Architecture (ADK Pattern)

```
User (voice / text / image)
        │
        ▼
Gemini Live API  ←──── real-time bidirectional audio (PCM 16kHz ↔ 24kHz)
  gemini-2.0-flash-live-001
  ↳ collects goal, genre, links via voice conversation
  ↳ calls trigger_generation() tool when ready
        │
        ▼
╔══════════════════════════════════════════════════════════╗
║              Echo Multi-Agent Pipeline                   ║
║                                                          ║
║  Agent 1: ContentAnalystAgent                            ║
║    └─ Scrapes URLs (YouTube / Twitter / Web)             ║
║    └─ Extracts themes + insights (Gemini 2.5 Flash)      ║
║                     │                                    ║
║  Agent 2: CreativeDirectorAgent                          ║
║    └─ Writes 16-line lyrics                              ║
║    └─ Album art direction + musical DNA                  ║
║    └─ Gemini 2.5 Pro (best creative quality)             ║
║                     │                                    ║
║         ┌───────────┴───────────┐                        ║
║  Agent 3a: ArtistAgent          │                        ║
║    └─ Imagen 4 → album cover    │  (parallel)            ║
║    └─ Lyria 3 → 30s music track │                        ║
║         └───────────┬───────────┘                        ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
        │
        ▼
Google Cloud Storage (album cover + audio)
        │
        ▼
Web Result Page  ←── real-time SSE progress updates
  lyrics · album art · audio player
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20, Express |
| Live voice | Gemini Live API (`gemini-2.0-flash-live-001`) via WebSocket |
| AI — text | Gemini 2.5 Pro / Flash (`@google/genai`) |
| AI — image | Imagen 4 (`imagen-4.0-generate-001`, Vertex AI) |
| AI — music | Lyria 3 (`lyria-003`, Vertex AI) |
| Database | Cloud Firestore (session state) |
| Storage | Google Cloud Storage (all generated media) |
| Bot | Telegraf v4 (Telegram webhook, optional) |
| Real-time | WebSocket (`ws`) + Server-Sent Events (SSE) |
| Deployment | Docker → Google Cloud Run |

---

## Project Structure

```
echo-knowledge-dj/
├── index.js            # HTTP + WebSocket server entry point
├── server.js           # Express — all web pages + SSE endpoint
├── live-session.js     # Gemini Live API WebSocket handler
├── ai_pipeline.js      # Thin orchestration — delegates to agents/
├── agents/
│   ├── index.js        # Multi-agent DAG orchestrator + pipelineEvents
│   ├── content_analyst.js    # Scrapes + analyzes source content
│   ├── creative_director.js  # Gemini 2.5 Pro lyrics + art direction
│   └── artist.js             # Imagen 4 + Lyria 3 (parallel)
├── bot.js              # Telegram bot (backup interface)
├── db.js               # Firestore helpers
├── scraper.js          # YouTube / Twitter / web content extraction
├── scripts/
│   └── setup_webhook.js
├── assets/
│   ├── echo_logo.jpg
│   └── Immutable_Code.mp3   # Fallback track if Lyria 3 unavailable
├── Dockerfile
├── .env.example
└── package.json
```

---

## Setup

### Prerequisites

- Node.js ≥ 20
- Google Cloud project with billing enabled
- APIs enabled: Vertex AI, Cloud Firestore, Cloud Storage
- Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
- Application Default Credentials: `gcloud auth application-default login`

### Local development

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Fill in GEMINI_API_KEY and GOOGLE_CLOUD_PROJECT at minimum

# 3. Run
npm run dev

# 4. Open
open http://localhost:8080/live
```

> For Telegram webhook testing, use a tunnel (e.g. ngrok) and set `CLOUD_RUN_URL` to the tunnel URL, then run `npm run setup-webhook`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Gemini API key — used for Live API + text generation |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `GOOGLE_CLOUD_REGION` | Vertex AI region (default: `us-central1`) |
| `GCS_BUCKET` | GCS bucket name for generated media |
| `CLOUD_RUN_URL` | Public URL of your deployed service |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather (optional) |
| `TELEGRAM_BOT_USERNAME` | Bot username without `@` (optional) |
| `PORT` | Server port (default: `8080`) |

---

## Deployment

```bash
# Build and deploy to Cloud Run
gcloud builds submit --tag gcr.io/$GOOGLE_CLOUD_PROJECT/echo-knowledge-dj

gcloud run deploy echo-knowledge-dj \
  --image gcr.io/$GOOGLE_CLOUD_PROJECT/echo-knowledge-dj \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=...,GOOGLE_CLOUD_PROJECT=...

# Register Telegram webhook (optional)
npm run setup-webhook
```

---

## Web Pages

| Route | Description |
|---|---|
| `/` | Landing page |
| `/live` | Voice session with Gemini Live API |
| `/demo` | Web form — enter goal, genre, and links without Telegram |
| `/digest/:chat_id` | Dashboard / Processing / Result (auto-switches by status) |
| `/api/pipeline-status/:chat_id` | SSE stream of real-time agent progress |

---

## Graceful Degradation

| Failure | Fallback |
|---|---|
| Lyria 3 unavailable | Uploads bundled `Immutable_Code.mp3` to GCS |
| Imagen 4 fails | Uses Echo logo as album cover |
| Gemini 2.5 Pro quota | Falls back to Gemini 2.5 Flash |
| Microphone denied | Text input available on `/live` page |

---

## License

MIT — Echo Team, 2026

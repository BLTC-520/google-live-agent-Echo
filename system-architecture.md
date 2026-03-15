# Echo — System Architecture & Flowchart

## 1. System Architecture Diagram

```mermaid
graph TB
    subgraph Client["🌐 Browser Client"]
        UI["Live Page /live\n(HTML + JS)"]
        MIC["Mic Capture\n16kHz PCM via AudioWorklet"]
        SPK["Audio Playback\n24kHz PCM"]
    end

    subgraph TG["📱 Telegram"]
        BOT_USER["User sends /start\n+ drops links"]
    end

    subgraph Server["☁️ Cloud Run — echo service"]
        IDX["index.js\nHTTP + WS server :8080"]
        SRV["server.js\nExpress routes + HTML pages"]
        LIVE["live-session.js\nGemini Live WS proxy"]
        BOT["bot.js\nTelegraf bot handler"]
        PIPE["ai_pipeline.js\nOrchestrator wrapper"]
        DB_MOD["db.js\nFirestore helpers"]

        subgraph Agents["🤖 Multi-Agent DAG (agents/)"]
            A1["Agent 1\ncontent_analyst.js\nScrape + Analyze"]
            A2["Agent 2\ncreative_director.js\nLyrics + Direction"]
            A3["Agent 3\nartist.js\nImagen4 + Lyria RealTime"]
            A1 --> A2 --> A3
        end
    end

    subgraph GCP["☁️ Google Cloud Platform"]
        GEMINI_LIVE["Gemini 2.5 Flash\nNative Audio Preview\n(AI Studio Live API)"]
        GEMINI_TEXT["Gemini 2.5 Pro/Flash\n(text generation)"]
        IMAGEN["Imagen 4\n(album art)"]
        LYRIA["Lyria 3\n(music generation via AI Studio)"]
        FS["Firestore\n(sessions)"]
        GCS["Cloud Storage\n(media files)"]
    end

    %% Browser <-> Server
    UI -->|"WebSocket /live-ws"| LIVE
    MIC -->|"PCM audio chunks"| LIVE
    LIVE -->|"audio chunks"| SPK
    UI -->|"HTTP GET /live"| SRV
    UI -->|"SSE /api/pipeline-status/:chatId"| SRV

    %% Telegram <-> Server
    BOT_USER -->|"HTTPS webhook"| BOT
    BOT -->|"inline buttons + messages"| BOT_USER

    %% Server internals
    IDX --> SRV
    IDX --> LIVE
    IDX --> BOT
    SRV --> PIPE
    SRV --> DB_MOD
    BOT --> DB_MOD
    BOT --> PIPE
    LIVE --> DB_MOD
    LIVE --> PIPE
    PIPE --> Agents

    %% Gemini Live <-> live-session.js
    LIVE <-->|"WSS BidiGenerateContent\nAI Studio v1alpha"| GEMINI_LIVE

    %% Agents <-> GCP
    A1 -->|"scrape + Gemini analysis"| GEMINI_TEXT
    A2 -->|"lyrics generation"| GEMINI_TEXT
    A3 -->|"image generation"| IMAGEN
    A3 -->|"music generation"| LYRIA
    A3 -->|"upload media"| GCS

    %% DB
    DB_MOD <-->|"read/write sessions"| FS
    GCS -->|"public media URLs"| SRV
```

---

## 2. User Flow — Voice Onboarding (Gemini Live)

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant Server as Cloud Run Server
    participant GeminiLive as Gemini Live API
    participant Pipeline as Multi-Agent Pipeline
    participant GCS as Cloud Storage

    User->>Browser: Opens /live?chatId=xxx
    Browser->>Server: GET /live → HTML page
    Browser->>Server: WebSocket connect /live-ws
    Server->>GeminiLive: WSS open + send {setup: model, config, tools}
    GeminiLive-->>Server: {setupComplete}
    Server-->>Browser: {type: "ready"}
    Note over Server,GeminiLive: Server nudges Gemini with "Hello"
    Server->>GeminiLive: clientContent "Hello"
    GeminiLive-->>Server: audio chunks (greeting)
    Server-->>Browser: {type: "audio", data: base64PCM}
    Browser->>User: 🔊 Echo speaks greeting

    User->>Browser: Clicks orb → mic on
    User->>Browser: 🎤 Speaks (learning goal, genre, URLs)
    Browser->>Server: PCM audio stream (16kHz chunks)
    Server->>GeminiLive: realtimeInput mediaChunks
    GeminiLive-->>Server: audio reply + transcript
    Server-->>Browser: audio + ai_text
    Browser->>User: 🔊 Echo responds

    Note over GeminiLive: After user provides goal+genre+links...
    GeminiLive-->>Server: toolCall: trigger_generation(goal, genre, links)
    Server->>Server: updateSession() in Firestore
    Server->>GeminiLive: toolResponse {success: true}
    Server-->>Browser: {type: "generation_started", digestUrl: "/digest/xxx"}
    Browser->>Server: GET /digest/xxx → processing page (HTML)
    Note over Browser: showProgressPanel() opens SSE connection

    Server->>Pipeline: runGenerationPipeline(chatId) [fire-and-forget]
    Pipeline->>Pipeline: Agent 1 → 2 → 3
    Pipeline->>GCS: Upload audio, image
    Pipeline-->>Browser: SSE progress events (stage, progress %)
    Note over Browser: On stage=complete → window.location.href = /digest/xxx
    Browser->>Server: GET /digest/xxx → result page (status=completed)
```

---

## 3. Generation Pipeline Flowchart

```mermaid
flowchart TD
    START([User confirms generation]) --> A1

    subgraph A1["Agent 1: Content Analyst"]
        SA["Scrape URLs\n(web/YouTube/Twitter)"]
        GA["Gemini 2.5 Pro\nAnalyze content"]
        SA --> GA
    end

    A1 --> A2

    subgraph A2["Agent 2: Creative Director"]
        LD["Generate Lyrics\n(Gemini 2.5 Pro)"]
        MD["Musical DNA\nBPM, mood, key, style"]
        IP["Image Prompt\nfor Imagen 4"]
        LD --> MD --> IP
    end

    A2 --> A3

    subgraph A3["Agent 3: Artist"]
        IG["Imagen 4\nGenerate album art"]
        LY{"Lyria RealTime\nGenerate music\n(WebSocket)"}
        LY_OK["Upload audio to GCS"]
        LY_FB["Fallback:\nImmutable_Code.mp3"]
        IG --> LY
        LY -->|success| LY_OK
        LY -->|fail| LY_FB
    end

    A3 --> SAVE["Update Firestore session\nstatus: completed\nall URLs stored"]
    SAVE --> SSE["SSE event → browser\nredirect to result page"]
    SSE --> DONE([Result page shown])
```

---

## 4. Data Model (Firestore)

```
sessions/{chatId}
├── chatId: string
├── username: string
├── goal: string          ← learning topic
├── genre: string         ← music genre
├── links: string[]       ← source URLs
├── status: "pending" | "processing" | "completed" | "error"
├── created_at: timestamp
└── generation_results:
    ├── track_title: string    ← short catchy song name (3-5 words)
    ├── lyrics: string         ← AI-written learning verses (Gemini 2.5 Pro)
    ├── image_url: string      ← GCS public URL (Imagen 4 album cover)
    ├── audio_url: string      ← GCS public URL (Lyria WAV track)
    ├── audio_mime_type: string ← e.g. "audio/wav" or "audio/mpeg"
    ├── image_prompt: string
    └── musical_dna:
        ├── bpm: string
        ├── mood: string
        └── key: string
```

---

## 5. Bug Fixes Applied

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Frontend never redirected to result page after pipeline complete | `live-session.js` sent absolute `digestUrl` (`http://host/digest/id`); client security check required relative path starting with `/` so `dest` was always `null` | Changed server to send `/digest/${chatId}` (path only, no origin) |
| Result page showed no track title | `track_title` field existed in `generation_results` but was never rendered | Added `<div class="track-title">` in hero block of result page |

---

## 6. Result Page Design (Spotify-inspired)

```
┌─────────────────────────────────────────┐
│  ECHO nav                  + New Track  │
├─────────────────────────────────────────┤
│  [blurred album bg — full page]         │
│                                         │
│       [Album Art 220×220]               │
│    Track Title Here                     │
│    🎯 Web3 security  •  🎵 Synthwave    │
│    BPM 120  •  Mood: Focused  •  C Maj  │
│                                         │
│  ─── LYRICS ────────────────────────── │
│    line 1 (dim)                         │
│    LINE 2 ACTIVE (large, accent)        │
│    line 3 (near — medium)               │
│    line 4 (dim)                         │
│                                         │
├─────────────────────────────────────────┤
│ [art] Track Title    ▶  ──●──  0:23/1:00│  ← sticky player bar
│       Genre               [Download]   │
└─────────────────────────────────────────┘
```

Key features:
- Blurred album art as page background (`filter: blur(80px) brightness(0.18)`)
- Lyric lines: `active` (large, full color) / `near` (adjacent lines, medium) / dim (rest)
- Custom player bar: play/pause SVG swap, scrubable progress track, keyboard seek (←→ ±5s, Space)
- `+ New Track` nav link routes back to `/live`

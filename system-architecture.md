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
            A3["Agent 3\nartist.js\nImagen4 + Lyria3"]
            A4["Agent 4\nvideographer.js\nVeo3 Video"]
            A1 --> A2 --> A3 --> A4
        end
    end

    subgraph GCP["☁️ Google Cloud Platform"]
        GEMINI_LIVE["Gemini 2.5 Flash\nNative Audio Preview\n(AI Studio Live API)"]
        GEMINI_TEXT["Gemini 2.5 Pro/Flash\n(text generation)"]
        IMAGEN["Imagen 4\n(album art)"]
        LYRIA["Lyria 3\n(music generation)"]
        VEO["Veo 3\n(music video)"]
        FS["Firestore\n(sessions)"]
        GCS["Cloud Storage\n(media files)"]
    end

    %% Browser <-> Server
    UI -->|"WebSocket /live-ws"| LIVE
    MIC -->|"PCM audio chunks"| LIVE
    LIVE -->|"audio chunks"| SPK
    UI -->|"HTTP GET /live"| SRV
    UI -->|"SSE /events/:chatId"| SRV

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
    A4 -->|"video generation"| VEO
    A3 -->|"upload media"| GCS
    A4 -->|"upload video"| GCS

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
    Browser->>Server: {type: "text", data: "Hello"}
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
    Browser->>User: Redirects to /digest/xxx

    Server->>Pipeline: runGenerationPipeline(chatId) [async]
    Pipeline->>Pipeline: Agent 1 → 2 → 3 → 4
    Pipeline->>GCS: Upload audio, image, video
    Pipeline->>Server: SSE progress events
    Browser->>User: Shows processing page → result page
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
        LY{"Lyria 3\nGenerate music"}
        LY_OK["Upload audio to GCS"]
        LY_FB["Fallback:\nImmutable_Code.mp3"]
        IG --> LY
        LY -->|success| LY_OK
        LY -->|fail| LY_FB
    end

    A3 --> A4

    subgraph A4["Agent 4: Videographer"]
        VEO{"Veo 3\nGenerate video\nfrom image + prompt"}
        VEO_OK["Upload video to GCS"]
        VEO_SKIP["Skip video\n(optional field)"]
        VEO -->|success| VEO_OK
        VEO -->|fail/timeout| VEO_SKIP
    end

    A4 --> SAVE["Update Firestore session\nstatus: completed\nall URLs stored"]
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
    ├── lyrics: string
    ├── image_url: string      ← GCS public URL
    ├── audio_url: string      ← GCS public URL
    ├── video_url: string      ← GCS public URL (optional)
    ├── image_prompt: string
    └── musical_dna:
        ├── bpm: string
        ├── mood: string
        └── key: string
```

# Echo — Submission Description

## What Echo Does

Echo is a **multimodal Live Agent** that transforms what you're learning into a personalized music experience. Tell Echo your learning goal, share a few URLs — articles, YouTube videos, Twitter threads — and Echo turns them into a unique music track: an AI-generated instrumental, a Imagen 4 album cover, and AI-written verses that capture what the content was about.

The core idea: your reading list shouldn't just sit in a tab. It should become something you can feel.

---

## Features & Functionality

### 1. Voice-First Input via Gemini Live API
The primary interface is `/live` — a real-time voice session powered by Gemini 2.5 Flash Native Audio. Echo greets you by voice, asks for your learning goal, music genre, and URLs, then calls the `trigger_generation()` tool once it has all three. This is the **Live Agent** pattern at the core of the hackathon category: the conversation itself drives the agentic pipeline.

### 2. Web Form (No Mic Required)
`/demo` provides a fallback for judges or users without a microphone: a simple form with a learning goal text field, genre chip selector (Jazz, Lo-Fi, Hip-Hop, Electronic, etc.), and a URL textarea. Identical pipeline is triggered.

### 3. 3-Agent ADK-Style Pipeline
After the voice session collects inputs, Echo runs a DAG-structured multi-agent pipeline:

- **Agent 1 — ContentAnalystAgent**: Scrapes the submitted URLs (YouTube transcripts, web articles, Twitter/X threads) and uses Gemini 2.5 Flash to extract key themes, insights, and emotional tone.
- **Agent 2 — CreativeDirectorAgent**: Uses Gemini 2.5 Pro to write 16-line learning verses that distill the content, generate an album art direction prompt, and produce a full Musical DNA object (BPM, mood, key, scale, density, brightness).
- **Agent 3 — ArtistAgent**: Runs Imagen 4 and Lyria RealTime in **parallel**. Imagen 4 generates the album cover from the art direction prompt. Lyria RealTime receives the Musical DNA parameters and genre prompt over a WebSocket (`BidiGenerateMusic`) and streams 60 seconds of PCM audio, which is assembled into a WAV file and uploaded to Cloud Storage.

### 4. Real-Time SSE Progress
The processing page connects via Server-Sent Events to `/api/pipeline-status/:chatId` and shows a live 3-step progress stepper as each agent completes. No polling — pure event-driven.

### 5. Result Page
The result page shows the Imagen 4 album cover (with a blurred version as the page background), the track title, Musical DNA (BPM / Mood / Key), a sticky audio player with seek bar, and the AI-written learning verses that can be read while listening to the Lyria instrumental. A download button lets users save the audio file.

---

## Technologies Used

| Technology | How Echo uses it |
|---|---|
| **Gemini Live API** (`gemini-2.5-flash-native-audio-preview`) | Voice onboarding — real-time bidirectional audio + function calling to trigger the pipeline |
| **Gemini 2.5 Flash** | Content analysis — scrape summarization and theme extraction |
| **Gemini 2.5 Pro** | Creative writing — learning verses, Musical DNA, image prompt |
| **Imagen 4** (`imagen-4.0-generate-001`, Vertex AI) | Album cover generation |
| **Lyria RealTime** (`lyria-realtime-exp`, AI Studio) | 60-second instrumental music generation via WebSocket |
| **Cloud Firestore** | Session persistence — goal, genre, links, status, results |
| **Cloud Storage** | Hosts generated audio (WAV) and album art (PNG) with public URLs |
| **Cloud Run** | Serverless deployment via `deploy.sh` (one-command, `--source .`) |
| **Node.js / Express** | HTTP server, WebSocket proxy, SSE endpoint, server-rendered HTML |
| **Telegraf** | Optional Telegram bot interface (backup to voice + web form) |

---

## Data Sources

- **User-submitted URLs**: Any public webpage, YouTube video (transcript via `youtube-transcript`), or Twitter/X thread
- **Gemini 2.5 Pro**: Source of all creative text (verses, musical direction) — no external lyric databases
- **Lyria**: Music is generated from scratch per track — no audio samples or licensed content
- **Imagen 4**: Album art generated from scratch — no stock images

---

## Findings & Learnings

### Lyria RealTime WebSocket Protocol
The `BidiGenerateMusic` WebSocket protocol required reverse-engineering from the API spec. Key discoveries:
- The `setup` message **must include the `model` field** or the connection is rejected
- Prompts must be sent as `{ clientContent: { weightedPrompts: [...] } }` — not raw text
- Music config (`bpm`, `scale`, `density`, `brightness`) is sent as a separate `{ musicGenerationConfig: {...} }` message
- Audio arrives as base64-encoded PCM chunks in `serverContent.audioChunks[].data`
- Lyria generates **instrumental music** — the Musical DNA parameters (BPM, scale, mood) are the primary creative levers, not the text prompt itself. We adapted the product framing accordingly: Gemini 2.5 Pro writes the learning verses as a "reading companion" to the instrumental, not as lyrics to be sung.

### Gemini Live Tool Calling
The voice session uses Gemini's function calling to detect when the conversation has collected all required inputs (goal + genre + links). This is more robust than keyword detection and naturally handles multi-turn conversations where users give partial information.

### SSE + Fire-and-Forget Pipeline
Running the agent pipeline as a background async task while the browser connects via SSE was the right architecture. It cleanly separates the HTTP response (immediate) from the generation work (60–90 seconds), and late-joining clients replay the last known state from the in-memory `pipelineState` map.

### WAV Construction from PCM
Lyria streams raw 48kHz stereo 16-bit PCM. Building the WAV header manually (44-byte RIFF header) and concatenating chunks on the server side gave us full control over format and avoided client-side audio decoding complexity.

---

## What's Next

- **Live Lyria steering via voice**: Keep the Lyria WebSocket open during the Gemini Live session and relay voice commands ("make it more upbeat") as `setWeights` calls for real-time music steering — the definitive "Live Agent" demo
- **Track length control**: User-selectable 30s / 60s / 90s via the voice session or demo form
- **Share links**: Generate a permanent public URL for each result page

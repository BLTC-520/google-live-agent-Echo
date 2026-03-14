/**
 * Express server — web dashboard + Telegram webhook + Gemini Live UI.
 * Pages: Landing → Live Session → Dashboard → Processing → Result
 */
const express = require('express');
const path = require('path');
const { getSession } = require('./db');
const { bot } = require('./bot');
const { pipelineEvents } = require('./ai_pipeline');

const app = express();

// --- Middleware ---
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// --- Telegram Webhook ---
app.use(bot.webhookCallback('/webhook'));

// --- SSE: Pipeline progress updates ---
app.get('/api/pipeline-status/:chat_id', (req, res) => {
  const { chat_id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onProgress = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.stage === 'complete') res.end();
  };

  pipelineEvents.on(`progress:${chat_id}`, onProgress);

  req.on('close', () => {
    pipelineEvents.off(`progress:${chat_id}`, onProgress);
  });
});

// --- Shared Styles & Layout ---
function getBaseStyles() {
  return `
    /* Inter loaded via <link> in <head> for non-blocking delivery */

    :root {
      --bg:            #0c0e11;
      --surface-1:     #161820;
      --surface-2:     #1e2028;
      --border:        rgba(255,255,255,0.07);
      --text:          #ece8e2;
      --text-muted:    #8891a0;
      --text-subtle:   #606876;
      --accent:        #0eb8d0;
      --accent-dim:    rgba(14,184,208,0.1);
      --accent-border: rgba(14,184,208,0.18);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      overflow-x: hidden;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    /* Solid surface card */
    .glass {
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 16px;
    }

    /* Accent text — single color, not gradient */
    .gradient-text {
      color: var(--accent);
    }

    /* Echo branding */
    .logo-img {
      height: 32px;
      border-radius: 6px;
    }

    /* Buttons */
    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.75rem;
      background: var(--accent);
      color: #0c0e11;
      font-weight: 600;
      font-size: 0.95rem;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      text-decoration: none;
      transition: opacity 0.15s ease, transform 0.15s ease;
    }

    .btn-primary:hover {
      opacity: 0.88;
      transform: translateY(-1px);
    }

    .btn-secondary {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.75rem;
      background: transparent;
      color: var(--text);
      font-weight: 500;
      font-size: 0.95rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      cursor: pointer;
      text-decoration: none;
      transition: border-color 0.15s ease, background 0.15s ease;
    }

    .btn-secondary:hover {
      border-color: var(--accent-border);
      background: var(--accent-dim);
    }

    /* Nav bar */
    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 2rem;
      background: rgba(12,14,17,0.92);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      text-decoration: none;
    }

    .nav-brand-text {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--text);
    }

    .sr-only {
      position: absolute; width: 1px; height: 1px;
      padding: 0; margin: -1px; overflow: hidden;
      clip: rect(0,0,0,0); white-space: nowrap; border: 0;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;
}

// Shared <head> preconnect + font link — prevents render-blocking @import
function getFontLinks() {
  return `  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">`;
}

// =============================================================
// PAGE 1: Landing Page
// =============================================================
app.get('/', (req, res) => {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'EchoKnowledgeDJ_bot';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Echo — The Knowledge DJ</title>
  ${getFontLinks()}
  <meta name="description" content="Turn the links you consume into personalized music tracks with AI.">
  <style>
    ${getBaseStyles()}

    .hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 80px);
      text-align: center;
      padding: 2rem;
    }

    .hero-logo {
      width: 100px;
      height: auto;
      border-radius: 16px;
      margin-bottom: 2rem;
      opacity: 0.9;
    }

    .hero h1 {
      font-size: 3rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 1rem;
      line-height: 1.1;
    }

    .hero p {
      font-size: 1.05rem;
      color: var(--text-muted);
      max-width: 440px;
      margin-bottom: 2.5rem;
      line-height: 1.7;
    }

    @media (max-width: 768px) {
      .hero h1 { font-size: 2rem; }
      .hero-logo { width: 72px; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/echo_logo.jpg" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
  </nav>

  <main class="hero">
    <img src="/assets/echo_logo.jpg" alt="Echo — The Knowledge DJ" class="hero-logo">
    <h1><span class="gradient-text">The Knowledge DJ</span></h1>
    <p>Turn the links you consume into personalized music tracks. Feed me articles, videos, and tweets — I'll remix them into your daily soundtrack.</p>
    <div style="display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center;">
      <a href="/live" class="btn-primary">
        Talk to Echo Live
      </a>
      <a href="https://t.me/${botUsername}" class="btn-secondary" target="_blank">
        Telegram Bot
      </a>
    </div>
  </main>

</body>
</html>`);
});

// =============================================================
// PAGE 2/3/4: Digest Page — renders based on session status
// =============================================================
app.get('/digest/:chat_id', async (req, res) => {
  const { chat_id } = req.params;

  try {
    const session = await getSession(chat_id);

    if (session.status === 'processing') {
      return res.send(renderProcessingPage(session, chat_id));
    }

    if (session.status === 'completed') {
      return res.send(renderResultPage(session, chat_id));
    }

    // Default: idle / dashboard view
    return res.send(renderDashboardPage(session, chat_id));
  } catch (err) {
    console.error('[Server] Digest page error:', err);
    res.status(500).send(renderErrorPage());
  }
});

// =============================================================
// Dashboard Page (Wireframe #2) — shows queued links, goal, genre
// =============================================================
function renderDashboardPage(session, chatId) {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'EchoKnowledgeDJ_bot';
  const linksHtml = (session.links || [])
    .map((link, i) => `
      <div class="link-item glass" style="padding: 0.875rem 1.25rem; margin-bottom: 0.5rem; border-radius: 10px; display: flex; align-items: center; gap: 0.75rem;">
        <span style="color: var(--accent); font-size: 0.8rem; font-weight: 600; opacity: 0.6; flex-shrink: 0;">${String(i + 1).padStart(2, '0')}</span>
        <a href="${safeUrl(link)}" target="_blank" rel="noopener noreferrer" class="link-item-url">
          ${escapeHtml(link)}
        </a>
      </div>`)
    .join('') || '<p style="color: var(--text-subtle); text-align: center; padding: 2rem;">No links queued yet. Send links via Telegram!</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Playlist — Echo</title>
  ${getFontLinks()}
  <style>
    ${getBaseStyles()}

    .dashboard {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 2rem;
      margin-top: 2rem;
      min-height: calc(100vh - 160px);
    }

    .links-panel {
      padding: 2rem;
    }

    .links-panel h2 {
      font-size: 1.4rem;
      font-weight: 700;
      margin-bottom: 1.5rem;
    }

    .links-list {
      max-height: 60vh;
      overflow-y: auto;
      padding-right: 0.5rem;
    }

    .links-list::-webkit-scrollbar { width: 4px; }
    .links-list::-webkit-scrollbar-track { background: transparent; }
    .links-list::-webkit-scrollbar-thumb { background: var(--accent-border); border-radius: 4px; }

    .link-item-url {
      color: var(--text-muted);
      text-decoration: none;
      word-break: break-all;
      font-size: 0.875rem;
      transition: color 0.15s ease;
    }
    .link-item-url:hover { color: var(--accent); }

    .profile-panel {
      padding: 2rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      text-align: center;
    }

    .avatar {
      width: 72px; height: 72px;
      border-radius: 50%;
      background: var(--surface-2);
      border: 1px solid var(--accent-border);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.5rem; font-weight: 600; color: var(--accent);
    }

    .meta-tag {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0.35rem 0.75rem;
      background: var(--accent-dim);
      border: 1px solid var(--accent-border);
      border-radius: 6px;
      font-size: 0.8rem;
      color: var(--accent);
      font-weight: 500;
    }

    .generate-area {
      margin-top: auto;
      width: 100%;
    }

    @media (max-width: 768px) {
      .dashboard { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/echo_logo.jpg" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
  </nav>

  <main class="container">
    <h1 class="sr-only">Your Echo Dashboard</h1>
    <div class="dashboard">
      <div class="links-panel glass">
        <h2>Links Consumed</h2>
        <div class="links-list">${linksHtml}</div>
      </div>

      <div class="profile-panel glass">
        <div class="avatar" aria-hidden="true">${escapeHtml((session.username || '?')[0].toUpperCase())}</div>
        <h3 style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${escapeHtml(session.username || 'User')}</h3>

        <div>
          <p style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-subtle); margin-bottom: 0.5rem;">Daily Goal</p>
          <span class="meta-tag" title="${escapeHtml(session.goal || 'Not set')}">${escapeHtml(session.goal || 'Not set')}</span>
        </div>

        <div>
          <p style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-subtle); margin-bottom: 0.5rem;">Genre</p>
          <span class="meta-tag" title="${escapeHtml(session.genre || 'Not set')}">${escapeHtml(session.genre || 'Not set')}</span>
        </div>

        <div class="generate-area">
          <a href="https://t.me/${botUsername}?start=generate" class="btn-primary" style="width: 100%; justify-content: center;">
            Generate Today's Track
          </a>
        </div>
      </div>
    </div>
  </main>
</body>
</html>`;
}

// =============================================================
// Processing Page (Wireframe #3) — animated spinner
// =============================================================
function renderProcessingPage(session, chatId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mastering Your Track... — Echo</title>
  ${getFontLinks()}
  <meta http-equiv="refresh" content="15">
  <style>
    ${getBaseStyles()}

    .processing {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 80px);
      text-align: center;
      padding: 2rem;
    }

    .processing h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin-top: 2.5rem;
      margin-bottom: 0.75rem;
    }

    .processing p {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    /* Soundwave ring animation */
    .wave-ring {
      position: relative;
      width: 200px;
      height: 200px;
    }

    .wave-ring .center-circle {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 80px; height: 80px;
      border-radius: 50%;
      background: var(--accent);
      opacity: 0.9;
    }

    .wave-ring .ring {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      border: 1px solid rgba(14,184,208,0.25);
      animation: ringPulse 2.4s ease-out infinite;
    }

    .wave-ring .ring:nth-child(2) { animation-delay: 0.5s; }
    .wave-ring .ring:nth-child(3) { animation-delay: 1s; }
    .wave-ring .ring:nth-child(4) { animation-delay: 1.5s; }
    .wave-ring .ring:nth-child(5) { animation-delay: 2s; }

    @keyframes ringPulse {
      0% { width: 80px; height: 80px; opacity: 0.7; }
      100% { width: 200px; height: 200px; opacity: 0; }
    }

    /* Equalizer bars */
    .equalizer {
      display: flex;
      gap: 3px;
      align-items: flex-end;
      height: 32px;
      margin-top: 2rem;
    }

    .eq-bar {
      width: 3px;
      border-radius: 2px;
      background: var(--accent);
      opacity: 0.7;
      animation: eqBounce 0.8s ease-in-out infinite alternate;
    }
    /* Stagger durations across bars using prime-ish offsets so they never sync */
    .eq-bar:nth-child(1)  { animation-duration: 0.65s; animation-delay: 0.00s; }
    .eq-bar:nth-child(2)  { animation-duration: 0.90s; animation-delay: 0.10s; }
    .eq-bar:nth-child(3)  { animation-duration: 0.72s; animation-delay: 0.20s; }
    .eq-bar:nth-child(4)  { animation-duration: 1.05s; animation-delay: 0.05s; }
    .eq-bar:nth-child(5)  { animation-duration: 0.60s; animation-delay: 0.15s; }
    .eq-bar:nth-child(6)  { animation-duration: 0.85s; animation-delay: 0.25s; }
    .eq-bar:nth-child(7)  { animation-duration: 0.70s; animation-delay: 0.08s; }
    .eq-bar:nth-child(8)  { animation-duration: 1.00s; animation-delay: 0.18s; }
    .eq-bar:nth-child(9)  { animation-duration: 0.78s; animation-delay: 0.03s; }
    .eq-bar:nth-child(10) { animation-duration: 0.92s; animation-delay: 0.22s; }
    .eq-bar:nth-child(11) { animation-duration: 0.67s; animation-delay: 0.12s; }
    .eq-bar:nth-child(12) { animation-duration: 0.83s; animation-delay: 0.30s; }

    @keyframes eqBounce {
      0% { height: 6px; }
      100% { height: 32px; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/echo_logo.jpg" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
  </nav>

  <main class="processing">
    <div class="wave-ring">
      <div class="ring"></div>
      <div class="ring"></div>
      <div class="ring"></div>
      <div class="ring"></div>
      <div class="ring"></div>
      <div class="center-circle"></div>
    </div>

    <h1><span class="gradient-text">Mastering Your Track...</span></h1>
    <p id="statusMsg">Mixing ${(session.links || []).length} source(s) into your ${escapeHtml(session.genre || 'custom')} track.</p>

    <!-- Agent progress bar -->
    <div style="width: 100%; max-width: 440px; margin-top: 1.5rem;">
      <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">
        <span id="agentLabel">Starting agents...</span>
        <span id="progressPct">0%</span>
      </div>
      <div style="background: var(--surface-2); border-radius: 100px; height: 4px; overflow: hidden;">
        <div id="progressBar" style="height: 100%; width: 0%; background: var(--accent); border-radius: 100px; transition: width 0.8s ease;"></div>
      </div>
    </div>

    <!-- Agent steps -->
    <div style="margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem; width: 100%; max-width: 440px;">
      <div class="agent-step" id="step-content_analyst">🔍 Content Analyst</div>
      <div class="agent-step" id="step-creative_director">✍️ Creative Director</div>
      <div class="agent-step" id="step-artist">🎨 Artist (Imagen 4 + Lyria 3)</div>
      <div class="agent-step" id="step-videographer">🎬 Videographer (Veo 3)</div>
    </div>

    <div class="equalizer" style="margin-top: 1.5rem;">
      ${Array.from({ length: 12 }, (_, i) => `<div class="eq-bar"></div>`).join('')}
    </div>
  </main>

  <style>
    .agent-step {
      padding: 0.6rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      color: var(--text-subtle);
      background: var(--surface-1);
      border: 1px solid var(--border);
      transition: color 0.3s ease, border-color 0.3s ease, background 0.3s ease;
    }
    .agent-step.active { color: var(--accent); background: var(--accent-dim); border-color: var(--accent-border); }
    .agent-step.done { color: var(--text-muted); }
    .agent-step.done::after { content: ' ✓'; color: var(--accent); opacity: 0.7; }
  </style>

  <script>
    const stageOrder = ['content_analyst', 'creative_director', 'artist', 'videographer'];
    let currentStageIdx = -1;
    let hardFallback = null;

    const evtSource = new EventSource('/api/pipeline-status/${chatId}');

    evtSource.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }

      const msg = data.message || '';
      document.getElementById('statusMsg').textContent = msg;
      document.getElementById('progressBar').style.width = (data.progress || 0) + '%';
      document.getElementById('progressPct').textContent = (data.progress || 0) + '%';
      document.getElementById('agentLabel').textContent = msg;

      const stageIdx = stageOrder.indexOf(data.stage);
      if (stageIdx >= 0) {
        // Mark previous stages done
        for (let i = 0; i < stageIdx; i++) {
          const el = document.getElementById('step-' + stageOrder[i]);
          if (el) { el.classList.remove('active'); el.classList.add('done'); }
        }
        // Mark current active
        const cur = document.getElementById('step-' + data.stage);
        if (cur) cur.classList.add('active');
        currentStageIdx = stageIdx;
      }

      if (data.stage === 'complete') {
        evtSource.close();
        clearTimeout(hardFallback);
        stageOrder.forEach(s => {
          const el = document.getElementById('step-' + s);
          if (el) { el.classList.remove('active'); el.classList.add('done'); }
        });
        setTimeout(() => window.location.reload(), 1200);
      }
    };

    evtSource.onerror = () => {
      // SSE not yet firing (pipeline just started or completed) — fall back to polling
      evtSource.close();
      clearTimeout(hardFallback);
      setTimeout(() => window.location.reload(), 8000);
    };

    // Hard fallback: reload after 25s if SSE never delivers
    hardFallback = setTimeout(() => window.location.reload(), 25000);
  </script>
</body>
</html>`;
}

// =============================================================
// Result Page (Wireframe #4) — album art, lyrics, audio, DNA
// =============================================================
function renderResultPage(session, chatId) {
  const results = session.generation_results || {};
  const dna = results.musical_dna || {};
  const hasAudio = results.audio_url && results.audio_url.length > 0;
  const hasVideo = results.video_url && results.video_url.length > 0;

  // Process lyrics: split by newlines for display
  const lyricsLines = (results.lyrics || 'No lyrics generated.')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const lyricsHtml = lyricsLines
    .map((line) => `<p class="lyric-line">${escapeHtml(line)}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Track — Echo</title>
  ${getFontLinks()}
  <style>
    ${getBaseStyles()}

    .result {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      margin-top: 2rem;
      min-height: calc(100vh - 160px);
    }

    /* Left panel — album art + controls */
    .album-panel {
      padding: 2rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
    }

    .album-cover {
      width: 100%;
      max-width: 400px;
      aspect-ratio: 1;
      border-radius: 20px;
      object-fit: cover;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      transition: transform 0.4s ease;
    }

    .album-cover:hover {
      transform: scale(1.02);
    }

    .controls {
      display: flex;
      gap: 1rem;
      width: 100%;
      max-width: 400px;
    }

    .controls .btn-primary,
    .controls .btn-secondary {
      flex: 1;
      justify-content: center;
    }

    audio {
      width: 100%;
      max-width: 400px;
      border-radius: 12px;
      outline: none;
    }

    audio::-webkit-media-controls-panel {
      background: rgba(255, 255, 255, 0.06);
    }

    /* Right panel — lyrics + DNA */
    .info-panel {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .lyrics-card {
      padding: 2rem;
      flex: 1;
    }

    .lyrics-card h2 {
      font-size: 1.2rem;
      font-weight: 700;
      margin-bottom: 1.25rem;
    }

    .lyric-line {
      font-size: 0.95rem;
      line-height: 2;
      color: var(--text-muted);
      transition: color 0.15s;
    }

    .lyric-line:hover {
      color: var(--text);
    }

    .dna-card {
      padding: 1.5rem 2rem;
    }

    .dna-card h3 {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 1rem;
    }

    .dna-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }

    .dna-item {
      text-align: center;
    }

    .dna-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-subtle);
      margin-bottom: 0.3rem;
    }

    .dna-value {
      font-size: 1rem;
      font-weight: 600;
      color: var(--accent);
    }

    @media (max-width: 768px) {
      .result {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/echo_logo.jpg" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
  </nav>

  <main class="container">
    <h1 class="sr-only">Your Generated Track</h1>
    <div class="result">
      <!-- Left: Album Art + Player -->
      <div class="album-panel glass">
        ${hasVideo ? `
        <video autoplay loop muted playsinline class="album-cover"
          poster="${safeUrl(results.image_url) || '/assets/echo_logo.jpg'}"
          aria-label="Generated music video">
          <source src="${safeUrl(results.video_url)}" type="video/mp4">
        </video>
        ` : `
        <img src="${safeUrl(results.image_url) || '/assets/echo_logo.jpg'}" alt="Generated album cover" class="album-cover" loading="lazy" width="400" height="400" />
        `}

        ${hasAudio ? `
        <audio controls preload="metadata" id="audioPlayer">
          <source src="${safeUrl(results.audio_url)}" type="${results.audio_mime_type || (results.audio_url.match(/\.mp3(\?|$)/i) ? 'audio/mpeg' : 'audio/wav')}">
          Your browser does not support the audio element.
        </audio>

        <div class="controls">
          <button class="btn-primary" onclick="document.getElementById('audioPlayer').play()">Play</button>
          <a href="${safeUrl(results.audio_url)}" download="echo-track" class="btn-secondary">Download</a>
        </div>
        ` : `
        <div class="controls">
          <button class="btn-secondary" disabled aria-disabled="true" style="flex: 1; justify-content: center; opacity: 0.5; cursor: default;">
            Audio generating...
          </button>
        </div>
        `}
      </div>

      <!-- Right: Lyrics + Musical DNA -->
      <div class="info-panel">
        <div class="lyrics-card glass">
          <h2>Lyrics</h2>
          <div class="lyrics-container">${lyricsHtml}</div>
        </div>

        <div class="dna-card glass">
          <h3><span class="gradient-text">Musical DNA</span></h3>
          <div class="dna-grid">
            <div class="dna-item">
              <div class="dna-label">BPM</div>
              <div class="dna-value">${escapeHtml(String(dna.bpm || '—'))}</div>
            </div>
            <div class="dna-item">
              <div class="dna-label">Mood</div>
              <div class="dna-value" style="font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(String(dna.mood || '—'))}</div>
            </div>
            <div class="dna-item">
              <div class="dna-label">Key</div>
              <div class="dna-value">${escapeHtml(String(dna.key || '—'))}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</body>
</html>`;
}

// =============================================================
// Error Page
// =============================================================
function renderErrorPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error — Echo</title>
  ${getFontLinks()}
  <style>
    ${getBaseStyles()}
    .error-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 80px);
      text-align: center;
      padding: 2rem;
    }
    .error-page h1 { font-size: 2rem; margin-bottom: 1rem; }
    .error-page p { color: var(--text-muted); margin-bottom: 2rem; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/echo_logo.jpg" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
  </nav>
  <main class="error-page">
    <h1>😔 Something went wrong</h1>
    <p>We couldn't load your digest. Please try again later.</p>
    <a href="/" class="btn-primary">← Back to Home</a>
  </main>
</body>
</html>`;
}

// =============================================================
// PAGE: Live Session — Voice-First Onboarding with Gemini Live API
// =============================================================
app.get('/live', (req, res) => {
  const chatId = req.query.chatId || String(Date.now());
  // Derive WebSocket URL from the browser's own location — works on localhost AND Cloud Run

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Talk to Echo — Live AI Session</title>
  ${getFontLinks()}
  <style>
    ${getBaseStyles()}

    .live-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: calc(100vh - 80px);
      padding: 2rem;
      gap: 2rem;
    }

    .live-hero {
      text-align: center;
      margin-top: 1.5rem;
    }

    .live-hero h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }

    .live-hero p {
      color: var(--text-muted);
      font-size: 0.95rem;
      max-width: 440px;
    }

    /* Voice orb */
    .voice-orb-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }

    .voice-orb {
      width: 120px; height: 120px;
      border-radius: 50%;
      background: var(--surface-2);
      border: 1.5px solid var(--border);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 2rem;
      transition: border-color 0.2s ease, transform 0.2s ease;
      position: relative;
      /* button reset */
      appearance: none;
      -webkit-appearance: none;
      padding: 0;
      font-family: inherit;
      color: inherit;
    }

    .voice-orb:hover:not(:disabled) { border-color: var(--accent-border); transform: scale(1.03); }
    .voice-orb:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
    .voice-orb.listening { border-color: var(--accent); animation: orbPulse 2s ease-in-out infinite; will-change: transform; }
    .voice-orb.speaking { border-color: var(--accent); opacity: 0.85; }
    .voice-orb:disabled, .voice-orb.disabled { opacity: 0.35; cursor: not-allowed; }

    @keyframes orbPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.04); }
    }

    .orb-label {
      font-size: 0.85rem;
      color: var(--text-muted);
      text-align: center;
    }

    /* Session state panel */
    .session-state {
      width: 100%;
      max-width: 680px;
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 1rem;
    }

    .state-item {
      padding: 1rem;
      border-radius: 14px;
      text-align: center;
    }

    .state-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-subtle);
      margin-bottom: 0.4rem;
    }

    .state-value {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--accent);
      min-height: 1.3em;
    }

    /* Transcript */
    .transcript-panel {
      width: 100%;
      max-width: 680px;
      padding: 1.5rem;
      border-radius: 20px;
      min-height: 180px;
      max-height: 280px;
      overflow-y: auto;
    }

    .transcript-panel h3 {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-subtle);
      margin-bottom: 1rem;
    }

    .transcript-panel::-webkit-scrollbar { width: 4px; }
    .transcript-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

    .message {
      margin-bottom: 0.625rem;
      font-size: 0.9rem;
      line-height: 1.55;
      padding: 0.6rem 0.875rem;
      border-radius: 8px;
      max-width: 85%;
    }

    .message.echo { background: var(--surface-2); border-left: 2px solid var(--accent-border); color: var(--text); }
    .message.user { background: var(--surface-2); border-left: 2px solid var(--border); margin-left: auto; color: var(--text-muted); }
    .message.system { color: var(--text-subtle); font-size: 0.8rem; text-align: center; max-width: 100%; background: none; border: none; }

    /* Text input fallback */
    .text-input-row {
      width: 100%;
      max-width: 680px;
      display: flex;
      gap: 0.75rem;
    }

    .text-input-row input {
      flex: 1;
      padding: 0.75rem 1rem;
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }

    .text-input-row input:focus-visible { border-color: var(--accent-border); box-shadow: 0 0 0 2px var(--accent-dim); }
    .text-input-row input::placeholder { color: var(--text-subtle); }

    /* Image upload */
    .image-upload-btn {
      padding: 0.75rem 1rem;
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text-muted);
      font-size: 1rem;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .image-upload-btn:hover { border-color: var(--accent-border); color: var(--text); }

    #imageUploadInput { display: none; }

    /* Status bar */
    .status-bar {
      font-size: 0.82rem;
      color: var(--text-muted);
      text-align: center;
    }

    .status-bar .dot {
      display: inline-block;
      width: 6px; height: 6px;
      border-radius: 50%;
      margin-right: 0.4rem;
      background: var(--border);
      vertical-align: middle;
    }

    .status-bar.connected .dot { background: var(--accent); }
    .status-bar.listening .dot { background: var(--accent); animation: dotBlink 2s ease infinite; }
    .status-bar.speaking .dot { background: var(--accent); opacity: 0.6; animation: dotBlink 1s ease infinite; }

    @keyframes dotBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.25; }
    }

    @media (max-width: 600px) {
      .session-state { grid-template-columns: 1fr 1fr 1fr; }
      .text-input-row { flex-wrap: wrap; }
      .text-input-row input { min-width: 0; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/echo_logo.jpg" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <span style="font-size: 0.8rem; color: var(--text-subtle);">Live Session</span>
  </nav>

  <div class="live-container">
    <div class="live-hero">
      <h1><span class="gradient-text">Talk to Echo</span></h1>
      <p>Tell me what you're learning today. I'll turn your reading list into a personalized music track.</p>
    </div>

    <div class="voice-orb-wrapper">
      <button class="voice-orb disabled" id="voiceOrb" onclick="toggleMic()"
        aria-label="Start microphone" aria-pressed="false" disabled>🎤</button>
      <div class="orb-label" id="orbLabel" aria-live="polite">Connecting...</div>
    </div>

    <div class="status-bar" id="statusBar" role="status" aria-live="polite">
      <span class="dot" aria-hidden="true"></span>
      <span id="statusText">Connecting to Gemini Live...</span>
    </div>

    <!-- Collected session data -->
    <div class="session-state" aria-label="Session summary">
      <div class="state-item glass">
        <div class="state-label" id="label-goal">Learning Goal</div>
        <div class="state-value" id="stateGoal" aria-labelledby="label-goal">—</div>
      </div>
      <div class="state-item glass">
        <div class="state-label" id="label-genre">Genre</div>
        <div class="state-value" id="stateGenre" aria-labelledby="label-genre">—</div>
      </div>
      <div class="state-item glass">
        <div class="state-label" id="label-links">Links</div>
        <div class="state-value" id="stateLinks" aria-labelledby="label-links">0</div>
      </div>
    </div>

    <!-- Transcript -->
    <div class="transcript-panel glass" id="transcript" role="log" aria-label="Conversation" aria-live="polite">
      <h3>Conversation</h3>
    </div>

    <!-- Text fallback + image upload -->
    <div class="text-input-row">
      <input type="text" id="textInput" autocomplete="off"
        placeholder="Type a message or paste a URL..."
        onkeydown="if(event.key==='Enter') sendText()"
        aria-label="Message input">
      <button class="image-upload-btn" id="imageBtn"
        onclick="document.getElementById('imageUploadInput').click()"
        aria-label="Share an image">📎</button>
      <input type="file" id="imageUploadInput" accept="image/*" onchange="sendImage(this)" aria-hidden="true">
      <button class="btn-primary" id="sendBtn" onclick="sendText()" style="padding: 0.75rem 1.25rem;">Send</button>
    </div>
  </div>

  <script>
    const CHAT_ID = '${chatId}';
    const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live-ws?chatId=${chatId}';

    let ws = null;
    let inputCtx = null;   // 16kHz — mic capture only
    let outputCtx = null;  // 24kHz — Gemini audio playback only
    let micStream = null;
    let workletNode = null;      // AudioWorklet path (preferred)
    let scriptProcessor = null;  // Legacy fallback
    let isMicActive = false;
    let nextAudioTime = 0;
    const SAMPLE_RATE_IN = 16000;
    const SAMPLE_RATE_OUT = 24000;

    // AudioWorklet processor — resamples from device native rate → 16kHz,
    // accumulates into 4096-sample chunks and posts PCM Float32 to main thread.
    const WORKLET_CODE = \`
      class PCMCaptureProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this._buf = [];
          this._phase = 0;
          this._targetRate = 16000;
        }
        process(inputs) {
          const ch = inputs[0] && inputs[0][0];
          if (!ch) return true;
          const step = sampleRate / this._targetRate; // e.g. 48000/16000 = 3
          while (this._phase < ch.length) {
            const i = Math.min(Math.floor(this._phase), ch.length - 1);
            this._buf.push(ch[i]);
            this._phase += step;
          }
          this._phase -= ch.length;
          if (this._buf.length >= 4096) {
            const chunk = new Float32Array(this._buf.splice(0, 4096));
            this.port.postMessage(chunk.buffer, [chunk.buffer]);
          }
          return true;
        }
      }
      registerProcessor('pcm-capture', PCMCaptureProcessor);
    \`;

    // ── WebSocket ───────────────────────────────────────────────────
    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setStatus('connected', 'Connected — click the mic to start talking');
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      };

      ws.onclose = () => {
        setStatus('disconnected', 'Disconnected. Refreshing...');
        setTimeout(() => window.location.reload(), 2000);
      };

      ws.onerror = () => {
        addMessage('system', '⚠️ Connection error. Please refresh the page.');
      };
    }

    function handleServerMessage(msg) {
      switch (msg.type) {
        case 'ready': {
          const orb = document.getElementById('voiceOrb');
          orb.disabled = false;
          orb.classList.remove('disabled');
          orb.setAttribute('aria-label', 'Start microphone');
          setStatus('connected', 'Ready — click the mic to start talking');
          document.getElementById('orbLabel').textContent = 'Click to start talking';
          // Nudge Gemini to send its opening greeting
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'text', data: 'Hello' }));
          }
          break;
        }

        case 'audio':
          playAudio(msg.data);
          setOrbState('speaking');
          break;

        case 'turn_complete':
          // If mic is live, go back to listening so user can barge in immediately
          if (isMicActive) setOrbState('listening');
          else setOrbState('idle');
          break;

        case 'ai_text':
          if (msg.text && msg.text.trim()) {
            addMessage('echo', msg.text);
          }
          break;

        case 'generation_started': {
          addMessage('system', 'Creating your track — redirecting shortly...');
          // Only follow same-origin relative paths to prevent open redirect
          const dest = typeof msg.digestUrl === 'string' && msg.digestUrl.startsWith('/') ? msg.digestUrl : null;
          if (dest) setTimeout(() => { window.location.href = dest; }, 2500);
          break;
        }

        case 'error':
          addMessage('system', '⚠️ ' + msg.message);
          setStatus('connected', 'Error occurred');
          break;

        case 'closed':
          setStatus('disconnected', 'Session ended');
          break;
      }
    }

    // ── Microphone ──────────────────────────────────────────────────
    // First click: start always-on mic (barge-in supported).
    // Second click: end the whole session (mic + WS).
    async function toggleMic() {
      const orb = document.getElementById('voiceOrb');
      if (orb.disabled) return;

      if (isMicActive) {
        // Second click = end session
        stopMic();
        if (ws && ws.readyState === 1) ws.close();
      } else {
        await startMic();
      }
    }

    async function startMic() {
      try {
        // Input context: native device rate — worklet resamples down to 16kHz
        if (!inputCtx) {
          inputCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (inputCtx.state === 'suspended') await inputCtx.resume();

        // Output context: 24kHz for playing Gemini's audio response
        if (!outputCtx) {
          outputCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUT });
        }
        if (outputCtx.state === 'suspended') await outputCtx.resume();

        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const source = inputCtx.createMediaStreamSource(micStream);

        function sendPCM(pcmFloat) {
          if (!isMicActive || !ws || ws.readyState !== 1) return;
          const int16 = new Int16Array(pcmFloat.length);
          for (let i = 0; i < pcmFloat.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, Math.round(pcmFloat[i] * 32767)));
          }
          ws.send(JSON.stringify({ type: 'audio', data: arrayBufferToBase64(int16.buffer) }));
        }

        if (inputCtx.audioWorklet) {
          // Modern path: runs off main thread — no audio glitches under UI load
          const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          try {
            await inputCtx.audioWorklet.addModule(url);
          } finally {
            URL.revokeObjectURL(url);
          }
          workletNode = new AudioWorkletNode(inputCtx, 'pcm-capture');
          workletNode.port.onmessage = ({ data }) => sendPCM(new Float32Array(data));
          source.connect(workletNode);
        } else {
          // Legacy fallback: ScriptProcessor (main thread)
          scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (e) => sendPCM(e.inputBuffer.getChannelData(0));
          source.connect(scriptProcessor);
          scriptProcessor.connect(inputCtx.destination);
        }

        isMicActive = true;
        setOrbState('listening');
        setStatus('listening', 'Listening — interrupt Echo anytime. Click orb to end.');
        document.getElementById('orbLabel').textContent = 'Click to end';
      } catch (err) {
        addMessage('system', '⚠️ Microphone access denied. Use the text input below.');
        console.error('Mic error:', err);
      }
    }

    function stopMic() {
      isMicActive = false;
      if (workletNode) { workletNode.disconnect(); workletNode.port.onmessage = null; workletNode = null; }
      if (scriptProcessor) { scriptProcessor.disconnect(); scriptProcessor = null; }
      if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
      if (inputCtx) { inputCtx.close(); inputCtx = null; }
      setOrbState('idle');
      setStatus('connected', 'Ready — click the mic to start talking');
      document.getElementById('orbLabel').textContent = 'Click to start talking';
    }

    // ── Audio Playback (Gemini → Speaker, always 24kHz) ─────────────
    function playAudio(base64Data) {
      try {
        if (!outputCtx) {
          outputCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUT });
        }
        if (outputCtx.state === 'suspended') outputCtx.resume();

        const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;

        const buffer = outputCtx.createBuffer(1, float32.length, SAMPLE_RATE_OUT);
        buffer.copyToChannel(float32, 0);

        const source = outputCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(outputCtx.destination);

        const startAt = Math.max(outputCtx.currentTime, nextAudioTime);
        source.start(startAt);
        nextAudioTime = startAt + buffer.duration;
      } catch (err) {
        console.warn('Audio playback error:', err);
      }
    }

    // ── Text Input ───────────────────────────────────────────────────
    function sendText() {
      const input = document.getElementById('textInput');
      const btn = document.getElementById('sendBtn');
      const text = input.value.trim();
      if (!text || !ws || ws.readyState !== 1) return;
      btn.disabled = true;
      ws.send(JSON.stringify({ type: 'text', data: text }));
      addMessage('user', text);
      input.value = '';
      setTimeout(() => { btn.disabled = false; }, 400);
    }

    // ── Image Upload ─────────────────────────────────────────────────
    function sendImage(input) {
      const file = input.files[0];
      if (!file || !ws || ws.readyState !== 1) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result.split(',')[1];
        ws.send(JSON.stringify({ type: 'image', data: base64, mimeType: file.type }));
        addMessage('user', '🖼️ Shared an image');
      };
      reader.readAsDataURL(file);
      input.value = '';
    }

    // ── UI Helpers ────────────────────────────────────────────────────
    function setOrbState(state) {
      const orb = document.getElementById('voiceOrb');
      orb.classList.remove('listening', 'speaking');
      if (state === 'listening') {
        orb.classList.add('listening');
        orb.setAttribute('aria-pressed', 'true');
        orb.setAttribute('aria-label', 'Stop microphone');
      } else if (state === 'speaking') {
        orb.classList.add('speaking');
        orb.setAttribute('aria-pressed', 'false');
        orb.setAttribute('aria-label', 'Echo is speaking');
      } else {
        orb.setAttribute('aria-pressed', 'false');
        orb.setAttribute('aria-label', 'Start microphone');
        orb.style.willChange = 'auto'; // release compositor layer
      }
    }

    function setStatus(state, text) {
      const bar = document.getElementById('statusBar');
      bar.className = 'status-bar ' + state;
      document.getElementById('statusText').textContent = text;
    }

    function addMessage(role, text) {
      const panel = document.getElementById('transcript');
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = text;
      panel.appendChild(div);
      panel.scrollTop = panel.scrollHeight;

      // Update state display from Echo messages
      if (role === 'echo') extractStateFromText(text);
    }

    function extractStateFromText(text) {
      // Simple heuristic to show collected data
      const lower = text.toLowerCase();
      if (lower.includes('goal') && lower.includes(':')) {
        const match = text.match(/goal[^:]*:\s*["']?([^"'.!?]+)/i);
        if (match) document.getElementById('stateGoal').textContent = match[1].trim().substring(0, 30);
      }
      if (lower.includes('genre') && lower.includes(':')) {
        const match = text.match(/genre[^:]*:\s*["']?([^"'.!?]+)/i);
        if (match) document.getElementById('stateGenre').textContent = match[1].trim().substring(0, 20);
      }
      const urlMatches = text.match(/https?:\\/\\/[^\\s]+/g);
      if (urlMatches) {
        const cur = parseInt(document.getElementById('stateLinks').textContent) || 0;
        document.getElementById('stateLinks').textContent = cur + urlMatches.length;
      }
    }

    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      // Chunked to avoid call-stack overflow on large buffers; O(n) vs. O(n²) concat
      const CHUNK = 0x8000;
      const parts = [];
      for (let i = 0; i < bytes.length; i += CHUNK) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
      }
      return btoa(parts.join(''));
    }

    // ── Boot ───────────────────────────────────────────────────────
    connect();
  </script>
</body>
</html>`);
});

// =============================================================
// Utility
// =============================================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Only allow http/https URLs; returns escaped safe URL or '#' on rejection
function safeUrl(url) {
  if (typeof url !== 'string') return '#';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '#';
  return escapeHtml(trimmed);
}

module.exports = { app };

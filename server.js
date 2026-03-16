/**
 * Express server — web dashboard + Telegram webhook + Gemini Live UI.
 * Pages: Landing → Live Session → Dashboard → Processing → Result
 */
const express = require('express');
const path = require('path');
const { getSession, updateSession, listSessions } = require('./db');
const { bot } = require('./bot');
const { pipelineEvents, pipelineState, runGenerationPipeline } = require('./ai_pipeline');

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

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.stage === 'complete') res.end();
  };

  // Replay last known state so late-joining clients catch up immediately
  const currentState = pipelineState.get(chat_id);
  if (currentState) send(currentState);

  pipelineEvents.on(`progress:${chat_id}`, send);

  req.on('close', () => {
    pipelineEvents.off(`progress:${chat_id}`, send);
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

    .nav-links {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .nav-link {
      font-size: 0.85rem;
      color: var(--text-muted);
      text-decoration: none;
      padding: 0.4rem 0.75rem;
      border-radius: 8px;
      transition: color 0.15s, background 0.15s;
    }

    .nav-link:hover { color: var(--text); background: var(--surface-2); }
    .nav-link.active { color: var(--accent); }

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

    @media (max-width: 480px) {
      .container { padding: 1rem; }
      .nav { padding: 0.75rem 1rem; }
      .btn-primary, .btn-secondary {
        padding: 0.65rem 1.25rem;
        font-size: 0.875rem;
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
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <div class="nav-links">
      <a href="/library" class="nav-link">Library</a>
    </div>
  </nav>

  <main class="hero">
    <img src="/assets/logo.png" alt="Echo — The Knowledge DJ" class="hero-logo">
    <h1><span class="gradient-text">The Knowledge DJ</span></h1>
    <p>Tell Echo what you're learning, share some links — and get a personalized AI-generated music track with album art, musical DNA, and AI-written verses. Powered by Gemini, Imagen 4, and Lyria.</p>
    <div style="display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center;">
      <a href="/live" class="btn-primary">
        🎤 Talk to Echo (Voice)
      </a>
      <a href="/demo" class="btn-secondary">
        ⌨️ Try via Form
      </a>
    </div>
    <p style="font-size:0.75rem;color:var(--text-subtle);margin-top:1rem;opacity:0.6;">No Telegram required &mdash; use voice or the web form</p>
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

    if (session.status === 'error') {
      return res.send(renderPipelineErrorPage(chat_id));
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

    @media (max-width: 480px) {
      .dashboard { margin-top: 1rem; }
      .links-panel { padding: 1.25rem; }
      .profile-panel { padding: 1.25rem; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <div class="nav-links">
      <a href="/library" class="nav-link">Library</a>
    </div>
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
// Processing Page (Wireframe #3) — phase stepper + progress bar
// =============================================================
function renderProcessingPage(session, chatId) {
  const sourceCount = (session.links || []).length;
  const genre = escapeHtml(session.genre || 'custom');

  const steps = [
    { id: 'content_analyst',   num: 1, icon: '🔍', label: 'Content Analyst',          desc: 'Reading & analyzing your sources' },
    { id: 'creative_director', num: 2, icon: '✍️', label: 'Creative Director',         desc: 'Writing lyrics & creative brief' },
    { id: 'artist',            num: 3, icon: '🎨', label: 'Artist',                    desc: 'Generating album cover & music' },
  ];

  const stepHtml = steps.map(s => `
      <div class="phase-step" id="step-${s.id}">
        <div class="phase-icon-wrap">
          <span class="phase-num">${s.num}</span>
          <svg class="phase-check" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="phase-spinner" aria-hidden="true">
            <div class="phase-spinner-ring"></div>
          </div>
        </div>
        <div class="phase-text">
          <span class="phase-label">${s.icon} ${s.label}</span>
          <span class="phase-desc">${s.desc}</span>
        </div>
        <div class="phase-status-badge">
          <span class="badge-pending">Pending</span>
          <span class="badge-active">In progress</span>
          <span class="badge-done">Done</span>
        </div>
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mastering Your Track... — Echo</title>
  ${getFontLinks()}
  <style>
    ${getBaseStyles()}

    /* ── Layout ── */
    .processing {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: calc(100vh - 80px);
      text-align: center;
      padding: 2rem 1rem;
    }

    .processing h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin-top: 2rem;
      margin-bottom: 0.5rem;
    }

    .processing .subtitle {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-bottom: 2rem;
    }

    /* ── Soundwave ring ── */
    .wave-ring {
      position: relative;
      width: 160px;
      height: 160px;
      flex-shrink: 0;
    }

    .wave-ring .center-circle {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 64px; height: 64px;
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

    @keyframes ringPulse {
      0%   { width: 64px;  height: 64px;  opacity: 0.7; }
      100% { width: 160px; height: 160px; opacity: 0; }
    }

    /* ── Overall progress bar ── */
    .progress-wrap {
      width: 100%;
      max-width: 480px;
      margin-bottom: 2rem;
    }

    .progress-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.5rem;
    }

    .progress-header #agentLabel {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .progress-header #progressPct {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--accent);
    }

    .progress-track {
      background: var(--surface-2);
      border-radius: 100px;
      height: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    #progressBar {
      height: 100%;
      width: 0%;
      background: var(--accent);
      border-radius: 100px;
      transition: width 0.8s ease;
      box-shadow: 0 0 8px rgba(14,184,208,0.5);
    }

    /* ── Phase stepper ── */
    .phases {
      width: 100%;
      max-width: 480px;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      text-align: left;
    }

    .phase-step {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface-1);
      transition: border-color 0.3s ease, background 0.3s ease;
    }

    /* Icon wrap — stacks num / check / spinner */
    .phase-icon-wrap {
      position: relative;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }

    .phase-num,
    .phase-check,
    .phase-spinner {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.25s ease;
    }

    .phase-num {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-subtle);
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1.5px solid var(--border);
      background: var(--surface-2);
    }

    .phase-check {
      opacity: 0;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(14,184,208,0.12);
      color: var(--accent);
    }

    .phase-check svg { width: 14px; height: 14px; }

    .phase-spinner {
      opacity: 0;
    }

    .phase-spinner-ring {
      width: 20px;
      height: 20px;
      border: 2px solid rgba(14,184,208,0.25);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* Text block */
    .phase-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }

    .phase-label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-subtle);
      transition: color 0.3s ease;
    }

    .phase-desc {
      font-size: 0.75rem;
      color: var(--text-subtle);
      opacity: 0.6;
      transition: opacity 0.3s ease;
    }

    /* Status badge */
    .phase-status-badge {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .badge-pending { color: var(--text-subtle); }
    .badge-active  { color: var(--accent);      display: none; }
    .badge-done    { color: var(--text-muted);  display: none; }

    /* ── States ── */
    .phase-step.active {
      border-color: var(--accent-border);
      background: var(--accent-dim);
    }

    .phase-step.active .phase-num     { opacity: 0; }
    .phase-step.active .phase-spinner { opacity: 1; }
    .phase-step.active .phase-label   { color: var(--accent); }
    .phase-step.active .phase-desc    { opacity: 1; }
    .phase-step.active .badge-pending { display: none; }
    .phase-step.active .badge-active  { display: inline; }

    .phase-step.done .phase-num     { opacity: 0; }
    .phase-step.done .phase-check   { opacity: 1; }
    .phase-step.done .phase-spinner { opacity: 0; }
    .phase-step.done .phase-label   { color: var(--text-muted); }
    .phase-step.done .badge-pending { display: none; }
    .phase-step.done .badge-done    { display: inline; }

    /* ── Equalizer ── */
    .equalizer {
      display: flex;
      gap: 3px;
      align-items: flex-end;
      height: 28px;
      margin-top: 1.75rem;
    }

    .eq-bar {
      width: 3px;
      border-radius: 2px;
      background: var(--accent);
      opacity: 0.55;
      animation: eqBounce 0.8s ease-in-out infinite alternate;
    }
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
      0%   { height: 4px; }
      100% { height: 28px; }
    }

    @media (max-width: 480px) {
      .processing { padding: 2rem 1rem; }
      .processing h1 { font-size: 1.4rem; }
      .progress-wrap { padding: 0 0.5rem; }
      .phases { padding: 0 0.25rem; }
      .phase-step { padding: 0.625rem 0.75rem; gap: 0.625rem; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <div class="nav-links">
      <a href="/library" class="nav-link">Library</a>
    </div>
  </nav>

  <main class="processing">
    <div class="wave-ring">
      <div class="ring"></div>
      <div class="ring"></div>
      <div class="ring"></div>
      <div class="ring"></div>
      <div class="center-circle"></div>
    </div>

    <h1><span class="gradient-text">Mastering Your Track...</span></h1>
    <p id="statusMsg" class="subtitle">Mixing ${sourceCount} source(s) into your ${genre} track.</p>

    <!-- Overall progress bar -->
    <div class="progress-wrap">
      <div class="progress-header">
        <span id="agentLabel">Starting agents...</span>
        <span id="progressPct">0%</span>
      </div>
      <div class="progress-track">
        <div id="progressBar"></div>
      </div>
    </div>

    <!-- Phase stepper -->
    <div class="phases">
      ${stepHtml}
    </div>

    <div class="equalizer">
      ${Array.from({ length: 12 }, () => '<div class="eq-bar"></div>').join('')}
    </div>
  </main>

  <script>
    const stageOrder = ['content_analyst', 'creative_director', 'artist'];
    let hardFallback = null;

    const evtSource = new EventSource('/api/pipeline-status/${chatId}');

    evtSource.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }

      const msg = data.message || '';
      const pct = data.progress || 0;

      document.getElementById('statusMsg').textContent = msg;
      document.getElementById('agentLabel').textContent = msg;
      document.getElementById('progressBar').style.width = pct + '%';
      document.getElementById('progressPct').textContent = pct + '%';

      const stageIdx = stageOrder.indexOf(data.stage);
      if (stageIdx >= 0) {
        // Mark previous stages done
        for (let i = 0; i < stageIdx; i++) {
          const el = document.getElementById('step-' + stageOrder[i]);
          if (el) { el.classList.remove('active'); el.classList.add('done'); }
        }
        // Mark current active
        const cur = document.getElementById('step-' + data.stage);
        if (cur) { cur.classList.remove('done'); cur.classList.add('active'); }
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
      // SSE not yet firing — fall back to polling
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
  const trackTitle = escapeHtml(results.track_title || 'Echo Track');
  const goal = escapeHtml(session.goal || '');
  const genre = escapeHtml(session.genre || '');
  const coverSrc = safeUrl(results.image_url) || '/assets/logo.png';
  const audioMime = results.audio_mime_type || (results.audio_url && results.audio_url.match(/\.mp3(\?|$)/i) ? 'audio/mpeg' : 'audio/wav');

  // Process lyrics: split by newlines for display
  const lyricsLines = (results.lyrics || 'No lyrics generated.')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const lyricsHtml = lyricsLines
    .map((line, i) => `<p class="lyric-line" data-line="${i}">${escapeHtml(line)}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${trackTitle} — Echo</title>
  ${getFontLinks()}
  <style>
    ${getBaseStyles()}

    /* ── Page shell ───────────────────────────────────────────── */
    html, body { height: 100%; }

    body {
      display: flex;
      flex-direction: column;
      padding-bottom: 100px; /* room for sticky player */
    }

    /* ── Background: blurred album art ────────────────────────── */
    .bg-blur {
      position: fixed;
      inset: 0;
      z-index: 0;
      background-image: url('${coverSrc}');
      background-size: cover;
      background-position: center;
      filter: blur(80px) brightness(0.18) saturate(1.4);
      transform: scale(1.1); /* prevent white edges from blur */
    }

    /* ── Content above the background ────────────────────────── */
    .page-content {
      position: relative;
      z-index: 1;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1.5rem 2rem;
      max-width: 720px;
      margin: 0 auto;
      width: 100%;
    }

    /* ── Hero block ───────────────────────────────────────────── */
    .hero-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.25rem;
      width: 100%;
      margin-bottom: 2.5rem;
    }

    .album-cover {
      width: 220px;
      height: 220px;
      border-radius: 18px;
      object-fit: cover;
      box-shadow: 0 24px 64px rgba(0,0,0,0.7);
      transition: transform 0.4s ease, box-shadow 0.4s ease;
    }

    .album-cover:hover {
      transform: scale(1.03);
      box-shadow: 0 32px 80px rgba(0,0,0,0.8);
    }

    .track-title {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.15;
      color: var(--text);
    }

    .meta-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: center;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.3rem 0.8rem;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 500;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.1);
      color: var(--text-muted);
    }

    .chip-accent {
      background: rgba(14,184,208,0.12);
      border-color: rgba(14,184,208,0.25);
      color: var(--accent);
    }

    .dna-row {
      display: flex;
      gap: 2rem;
      justify-content: center;
      flex-wrap: wrap;
    }

    .dna-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
    }

    .dna-label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text-subtle);
    }

    .dna-value {
      font-size: 1rem;
      font-weight: 600;
      color: var(--accent);
    }

    /* ── Learning Verses panel ────────────────────────────────── */
    .lyrics-section {
      width: 100%;
      border-top: 1px solid rgba(255,255,255,0.07);
      padding-top: 2rem;
    }

    .lyrics-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-subtle);
      text-align: center;
      margin-bottom: 0.4rem;
    }

    .lyrics-sublabel {
      font-size: 0.72rem;
      color: var(--text-subtle);
      opacity: 0.5;
      text-align: center;
      margin-bottom: 1.75rem;
    }

    .lyrics-scroll {
      display: flex;
      flex-direction: column;
      gap: 0;
      padding-bottom: 4rem;
    }

    .lyric-line {
      font-size: 1.2rem;
      line-height: 2.2;
      color: rgba(236,232,226,0.22);
      text-align: center;
      transition: color 0.5s ease, font-weight 0.3s ease;
      cursor: default;
    }

    .lyric-line.active {
      color: var(--text);
      font-weight: 600;
      text-shadow: 0 0 28px rgba(14,184,208,0.3);
    }

    .lyric-line.near {
      color: rgba(236,232,226,0.5);
    }

    /* ── Sticky player bar ────────────────────────────────────── */
    .player-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 10;
      background: rgba(12,14,17,0.88);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-top: 1px solid rgba(255,255,255,0.07);
      padding: 0.875rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }

    .player-art {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .player-info {
      flex-shrink: 0;
      min-width: 0;
      max-width: 180px;
      overflow: hidden;
    }

    .player-title {
      font-size: 0.85rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .player-genre {
      font-size: 0.72rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .player-controls {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      flex-shrink: 0;
    }

    .play-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--accent);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.15s ease, transform 0.15s ease;
      flex-shrink: 0;
    }

    .play-btn:hover { opacity: 0.85; transform: scale(1.06); }

    .play-btn svg { color: #0c0e11; }

    .player-seek {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-width: 0;
    }

    .time-label {
      font-size: 0.72rem;
      color: var(--text-muted);
      white-space: nowrap;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }

    .progress-track {
      flex: 1;
      height: 4px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
      cursor: pointer;
      position: relative;
    }

    .progress-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 2px;
      width: 0%;
      transition: width 0.25s linear;
      pointer-events: none;
    }

    .progress-thumb {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--accent);
      left: 0%;
      opacity: 0;
      transition: opacity 0.2s ease, left 0.25s linear;
      pointer-events: none;
    }

    .progress-track:hover .progress-thumb { opacity: 1; }

    .player-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    @media (max-width: 600px) {
      .player-info { display: none; }
      .player-actions { display: none; }
      .track-title { font-size: 1.5rem; }
      .album-cover { width: 160px; height: 160px; }
      .dna-row { gap: 1rem; }
      .page-content { padding: 1.5rem 1rem 1.5rem; }
      .player-bar { padding: 0.75rem 1rem; gap: 0.75rem; }
      .lyric-line { font-size: 1rem; }
    }
  </style>
</head>
<body>
  <div class="bg-blur" aria-hidden="true"></div>

  <nav class="nav" style="position:relative;z-index:2;">
    <a href="/" class="nav-brand">
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <div class="nav-links">
      <a href="/library" class="nav-link">Library</a>
      <a href="/live" class="btn-secondary" style="font-size:0.85rem;padding:0.5rem 1rem;">+ New Track</a>
    </div>
  </nav>

  <main class="page-content">
    <h1 class="sr-only">${trackTitle}</h1>

    <!-- Hero -->
    <div class="hero-block">
      <img src="${coverSrc}" alt="Album cover for ${trackTitle}" class="album-cover" loading="eager" width="220" height="220" />

      <div class="track-title">${trackTitle}</div>

      <div class="meta-chips">
        ${goal ? `<span class="chip">🎯 ${goal}</span>` : ''}
        ${genre ? `<span class="chip chip-accent">🎵 ${genre}</span>` : ''}
      </div>

      <div class="dna-row">
        <div class="dna-item">
          <span class="dna-label">BPM</span>
          <span class="dna-value">${escapeHtml(String(dna.bpm || '—'))}</span>
        </div>
        <div class="dna-item">
          <span class="dna-label">Mood</span>
          <span class="dna-value" style="font-size:0.9rem;">${escapeHtml(String(dna.mood || '—'))}</span>
        </div>
        <div class="dna-item">
          <span class="dna-label">Key</span>
          <span class="dna-value">${escapeHtml(String(dna.key || '—'))}</span>
        </div>
      </div>

      <!-- AI pipeline attribution — judges love this -->
      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:center;margin-top:0.5rem;">
        <span style="font-size:0.72rem;color:var(--text-subtle);opacity:0.55;">Made with</span>
        <span style="font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:999px;background:rgba(14,184,208,0.08);border:1px solid rgba(14,184,208,0.15);color:var(--accent);opacity:0.8;">Gemini 2.5 Pro</span>
        <span style="font-size:0.72rem;color:var(--text-subtle);opacity:0.35;">+</span>
        <span style="font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:999px;background:rgba(14,184,208,0.08);border:1px solid rgba(14,184,208,0.15);color:var(--accent);opacity:0.8;">Imagen 4</span>
        <span style="font-size:0.72rem;color:var(--text-subtle);opacity:0.35;">+</span>
        <span style="font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:999px;background:rgba(14,184,208,0.08);border:1px solid rgba(14,184,208,0.15);color:var(--accent);opacity:0.8;">Lyria</span>
      </div>
    </div>

    <!-- Learning Verses -->
    <section class="lyrics-section" aria-label="Learning Verses">
      <div class="lyrics-label">Learning Verses</div>
      <div class="lyrics-sublabel">Written by Gemini 2.5 Pro &middot; Read along while Lyria plays</div>
      <div class="lyrics-scroll" id="lyricsScroll">${lyricsHtml}</div>
    </section>
  </main>

  <!-- Hidden audio element -->
  ${hasAudio ? `<audio id="audioEl" preload="metadata">
    <source src="${safeUrl(results.audio_url)}" type="${audioMime}">
  </audio>` : ''}

  <!-- Sticky Player Bar -->
  <div class="player-bar" role="region" aria-label="Audio player">
    <img src="${coverSrc}" alt="" class="player-art" aria-hidden="true">
    <div class="player-info">
      <div class="player-title">${trackTitle}</div>
      <div class="player-genre">${genre || 'Echo Track'}</div>
    </div>
    <div class="player-controls">
      ${hasAudio ? `
      <button class="play-btn" id="playBtn" aria-label="Play">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <polygon id="iconPlay" points="5,3 19,12 5,21" />
          <rect id="iconPause1" x="6" y="4" width="4" height="16" style="display:none"/>
          <rect id="iconPause2" x="14" y="4" width="4" height="16" style="display:none"/>
        </svg>
      </button>
      ` : `
      <button class="play-btn" disabled aria-label="Audio unavailable" style="opacity:0.35;cursor:default;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
      `}
    </div>
    ${hasAudio ? `
    <div class="player-seek">
      <span class="time-label" id="timeCurrent">0:00</span>
      <div class="progress-track" id="progressTrack" role="slider" aria-label="Seek" tabindex="0">
        <div class="progress-fill" id="progressFill"></div>
        <div class="progress-thumb" id="progressThumb"></div>
      </div>
      <span class="time-label" id="timeDuration">0:00</span>
    </div>
    ` : `
    <div class="player-seek">
      <span class="time-label" style="flex:1;text-align:center;opacity:0.4;">No audio generated</span>
    </div>
    `}
    <div class="player-actions">
      ${hasAudio ? `<a href="${safeUrl(results.audio_url)}" download="echo-track" class="btn-secondary" style="padding:0.45rem 0.9rem;font-size:0.8rem;">Download</a>` : ''}
    </div>
  </div>

  ${hasAudio ? `
  <script>
    (function() {
      const audio = document.getElementById('audioEl');
      const playBtn = document.getElementById('playBtn');
      const iconPlay = document.getElementById('iconPlay');
      const iconPause1 = document.getElementById('iconPause1');
      const iconPause2 = document.getElementById('iconPause2');
      const progressFill = document.getElementById('progressFill');
      const progressThumb = document.getElementById('progressThumb');
      const progressTrack = document.getElementById('progressTrack');
      const timeCurrent = document.getElementById('timeCurrent');
      const timeDuration = document.getElementById('timeDuration');
      const lines = document.querySelectorAll('.lyric-line');
      let isPlaying = false;
      let lastIdx = -1;

      function fmt(s) {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + String(sec).padStart(2, '0');
      }

      function setPlaying(v) {
        isPlaying = v;
        iconPlay.style.display = v ? 'none' : '';
        iconPause1.style.display = v ? '' : 'none';
        iconPause2.style.display = v ? '' : 'none';
        playBtn.setAttribute('aria-label', v ? 'Pause' : 'Play');
      }

      audio.addEventListener('loadedmetadata', () => {
        timeDuration.textContent = fmt(audio.duration);
      });

      audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = pct + '%';
        progressThumb.style.left = pct + '%';
        timeCurrent.textContent = fmt(audio.currentTime);

        if (lines.length === 0) return;
        const idx = Math.min(
          Math.floor((audio.currentTime / audio.duration) * lines.length),
          lines.length - 1
        );
        if (idx === lastIdx) return;
        lastIdx = idx;
        lines.forEach((el, i) => {
          el.classList.toggle('active', i === idx);
          el.classList.toggle('near', i === idx - 1 || i === idx + 1);
          el.classList.remove('past');
        });
        lines[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

      audio.addEventListener('ended', () => {
        setPlaying(false);
        lastIdx = -1;
        lines.forEach(el => el.classList.remove('active', 'near', 'past'));
        progressFill.style.width = '0%';
        progressThumb.style.left = '0%';
        timeCurrent.textContent = '0:00';
      });

      playBtn.addEventListener('click', () => {
        if (isPlaying) { audio.pause(); setPlaying(false); }
        else { audio.play(); setPlaying(true); }
      });

      // Seek on progress track click
      progressTrack.addEventListener('click', (e) => {
        if (!audio.duration) return;
        const rect = progressTrack.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = pct * audio.duration;
      });

      // Keyboard seek
      progressTrack.addEventListener('keydown', (e) => {
        if (!audio.duration) return;
        if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
        if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
        if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
      });
    })();
  </script>
  ` : ''}
</body>
</html>`;
}

// =============================================================
// Pipeline Error Page — shown when generation_results.status === 'error'
// =============================================================
function renderPipelineErrorPage(chatId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generation Failed — Echo</title>
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
      gap: 1.25rem;
    }
    .error-page h1 { font-size: 1.75rem; }
    .error-page p { color: var(--text-muted); max-width: 400px; line-height: 1.6; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <div class="nav-links">
      <a href="/library" class="nav-link">Library</a>
    </div>
  </nav>
  <main class="error-page">
    <div style="font-size:3rem;">😔</div>
    <h1>Generation Failed</h1>
    <p>Something went wrong while mastering your track. This can happen if a source URL is unreachable or an AI model timed out.</p>
    <div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;">
      <a href="/demo" class="btn-primary">Try Again</a>
      <a href="/" class="btn-secondary">← Home</a>
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
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <div class="nav-links">
      <a href="/library" class="nav-link">Library</a>
    </div>
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
      .session-state { grid-template-columns: 1fr 1fr; }
      .text-input-row { flex-wrap: wrap; }
      .text-input-row input { min-width: 0; }
      .generate-buttons { flex-direction: column; }
      .live-hero h1 { font-size: 1.5rem; }
      .settings-panel { padding: 1rem; }
    }

    @media (max-width: 400px) {
      .session-state { grid-template-columns: 1fr; }
    }

    /* ── Music Settings Panel ── */
    .settings-panel {
      width: 100%;
      max-width: 480px;
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .settings-panel h3 {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-muted);
      margin: 0;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .settings-row {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .settings-row label {
      font-size: 0.82rem;
      color: var(--text-muted);
    }

    .scale-options {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .scale-options label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.88rem;
      color: var(--text);
      cursor: pointer;
    }

    .scale-options input[type="radio"] {
      accent-color: var(--accent);
    }

    .slider-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .slider-row input[type="range"] {
      flex: 1;
      accent-color: var(--accent);
      height: 4px;
      cursor: pointer;
    }

    .slider-value {
      font-size: 0.8rem;
      color: var(--text-muted);
      min-width: 2.5rem;
      text-align: right;
    }

    .generate-buttons {
      display: flex;
      gap: 0.75rem;
      width: 100%;
      max-width: 480px;
    }

    .btn-echo {
      flex: 1;
      padding: 0.8rem 1rem;
      background: linear-gradient(135deg, var(--accent), #7c3aed);
      color: #fff;
      border: none;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
    }

    .btn-echo:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .btn-echo:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    .btn-settings-gen {
      flex: 1;
      padding: 0.8rem 1rem;
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--accent-border);
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }

    .btn-settings-gen:hover:not(:disabled) { background: var(--surface-1); transform: translateY(-1px); }
    .btn-settings-gen:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    /* ── Inline generation progress panel ── */
    #progressPanel {
      display: none;
      width: 100%;
      max-width: 680px;
      flex-direction: column;
      gap: 1rem;
    }

    #progressPanel.visible { display: flex; }

    .prog-header {
      text-align: center;
    }

    .prog-header h2 {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
    }

    .prog-header p {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .prog-bar-wrap {
      background: var(--surface-2);
      border-radius: 100px;
      height: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    #liveProgressBar {
      height: 100%;
      width: 0%;
      background: var(--accent);
      border-radius: 100px;
      transition: width 0.8s ease;
      box-shadow: 0 0 8px rgba(14,184,208,0.5);
    }

    .prog-steps {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .prog-step {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.7rem 1rem;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface-1);
      font-size: 0.875rem;
      transition: border-color 0.3s, background 0.3s;
    }

    .prog-step .step-icon { font-size: 1rem; flex-shrink: 0; }
    .prog-step .step-label { flex: 1; color: var(--text-subtle); font-weight: 500; transition: color 0.3s; }
    .prog-step .step-badge { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-subtle); }

    .prog-step.active { border-color: var(--accent-border); background: var(--accent-dim); }
    .prog-step.active .step-label { color: var(--accent); }
    .prog-step.active .step-badge { color: var(--accent); }

    .prog-step.done .step-label { color: var(--text-muted); }
    .prog-step.done .step-badge { color: var(--text-subtle); }

    .prog-spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(14,184,208,0.25);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: none;
      flex-shrink: 0;
    }
    .prog-step.active .prog-spinner { display: block; }
    .prog-step.done .prog-spinner { display: none; }

    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
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

    <!-- Music Settings Panel -->
    <div class="settings-panel" id="settingsPanel">
      <h3>Music Settings</h3>
      <div class="settings-row">
        <label>Scale</label>
        <div class="scale-options">
          <label><input type="radio" name="scale" value="major" checked> Major (uplifting)</label>
          <label><input type="radio" name="scale" value="minor"> Minor (emotional)</label>
        </div>
      </div>
      <div class="settings-row">
        <label>Density — sparse &harr; full</label>
        <div class="slider-row">
          <input type="range" id="densitySlider" min="0" max="1" step="0.05" value="0.6"
            oninput="document.getElementById('densityVal').textContent = parseFloat(this.value).toFixed(2)">
          <span class="slider-value" id="densityVal">0.60</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Brightness — dark &harr; bright</label>
        <div class="slider-row">
          <input type="range" id="brightnessSlider" min="0" max="1" step="0.05" value="0.7"
            oninput="document.getElementById('brightnessVal').textContent = parseFloat(this.value).toFixed(2)">
          <span class="slider-value" id="brightnessVal">0.70</span>
        </div>
      </div>
    </div>

    <!-- Generate Buttons -->
    <div class="generate-buttons" id="generateButtons">
      <button class="btn-echo" id="btnStraightEcho" onclick="triggerStraightEcho()" disabled>
        ✨ Straight Echoing!
      </button>
      <button class="btn-settings-gen" id="btnGenerateSettings" onclick="triggerWithSettings()" disabled>
        Generate with Settings
      </button>
    </div>

    <!-- Transcript -->
    <div class="transcript-panel glass" id="transcript" role="log" aria-label="Conversation" aria-live="polite">
      <h3>Conversation</h3>
    </div>

    <!-- Text fallback + image upload -->
    <div class="text-input-row" id="textInputRow">
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

    <!-- Inline generation progress (shown after trigger_generation) -->
    <div id="progressPanel" aria-live="polite">
      <div class="prog-header">
        <h2><span class="gradient-text">Mastering Your Track...</span></h2>
        <p id="progStatusMsg">Starting agents...</p>
      </div>
      <div class="prog-bar-wrap">
        <div id="liveProgressBar"></div>
      </div>
      <div class="prog-steps">
        <div class="prog-step" id="pstep-content_analyst">
          <span class="step-icon">🔍</span>
          <span class="step-label">Content Analyst — Reading your sources</span>
          <div class="prog-spinner"></div>
          <span class="step-badge">Pending</span>
        </div>
        <div class="prog-step" id="pstep-creative_director">
          <span class="step-icon">✍️</span>
          <span class="step-label">Creative Director — Writing lyrics & brief</span>
          <div class="prog-spinner"></div>
          <span class="step-badge">Pending</span>
        </div>
        <div class="prog-step" id="pstep-artist">
          <span class="step-icon">🎨</span>
          <span class="step-label">Artist — Generating cover & music</span>
          <div class="prog-spinner"></div>
          <span class="step-badge">Pending</span>
        </div>
      </div>
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
          enableGenerateButtons();
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
          addMessage('system', '🎛️ Generation started — watch the progress below!');
          // Only follow same-origin relative paths to prevent open redirect
          const dest = typeof msg.digestUrl === 'string' && msg.digestUrl.startsWith('/') ? msg.digestUrl : null;
          showProgressPanel(dest);
          break;
        }

        case 'session_update': {
          // Authoritative state from server (e.g. voice-collected links)
          if (msg.goal) document.getElementById('stateGoal').textContent = msg.goal.substring(0, 30);
          if (msg.genre) document.getElementById('stateGenre').textContent = msg.genre.substring(0, 20);
          if (typeof msg.linksCount === 'number') {
            document.getElementById('stateLinks').textContent = msg.linksCount;
          }
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

      // Count URLs the user pastes — Echo never echoes them back so we must count here
      const urlMatches = text.match(/https?:\\/\\/[^\\s]+/g);
      if (urlMatches) {
        const el = document.getElementById('stateLinks');
        const cur = parseInt(el.textContent) || 0;
        el.textContent = cur + urlMatches.length;
      }

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

    // ── Inline generation progress ───────────────────────────────────
    const STAGE_ORDER = ['content_analyst', 'creative_director', 'artist'];

    function showProgressPanel(redirectDest) {
      // Hide the conversation UI, show progress panel
      document.getElementById('transcript').style.display = 'none';
      document.getElementById('textInputRow').style.display = 'none';
      document.getElementById('settingsPanel').style.display = 'none';
      document.getElementById('generateButtons').style.display = 'none';
      document.getElementById('progressPanel').classList.add('visible');

      // Stop mic capture and disable the orb
      stopMic();
      const orb = document.getElementById('voiceOrb');
      orb.disabled = true;
      orb.classList.add('disabled');
      document.getElementById('orbLabel').textContent = 'Generating...';

      // Connect to SSE for live pipeline updates
      const sse = new EventSource('/api/pipeline-status/' + CHAT_ID);

      sse.onmessage = (e) => {
        let data;
        try { data = JSON.parse(e.data); } catch { return; }

        // Update progress bar and status message
        const pct = data.progress || 0;
        document.getElementById('liveProgressBar').style.width = pct + '%';
        if (data.message) document.getElementById('progStatusMsg').textContent = data.message;

        const stageIdx = STAGE_ORDER.indexOf(data.stage);
        if (stageIdx >= 0) {
          // Mark previous stages done
          for (let i = 0; i < stageIdx; i++) {
            const el = document.getElementById('pstep-' + STAGE_ORDER[i]);
            if (el) {
              el.classList.remove('active');
              el.classList.add('done');
              el.querySelector('.step-badge').textContent = 'Done ✓';
            }
          }
          // Mark current stage active
          const cur = document.getElementById('pstep-' + data.stage);
          if (cur) {
            cur.classList.remove('done');
            cur.classList.add('active');
            cur.querySelector('.step-badge').textContent = 'In progress';
          }
        }

        if (data.stage === 'complete') {
          sse.close();
          STAGE_ORDER.forEach(s => {
            const el = document.getElementById('pstep-' + s);
            if (el) { el.classList.remove('active'); el.classList.add('done'); el.querySelector('.step-badge').textContent = 'Done ✓'; }
          });
          document.getElementById('progStatusMsg').textContent = '🎧 Your track is ready! Loading...';
          if (redirectDest) setTimeout(() => { window.location.href = redirectDest; }, 1500);
        }
      };

      sse.onerror = () => {
        sse.close();
        // SSE dropped — fall back to redirect if we have a dest
        if (redirectDest) setTimeout(() => { window.location.href = redirectDest; }, 3000);
      };
    }

    // ── Settings Panel helpers ────────────────────────────────────
    function getSessionState() {
      const goalEl = document.getElementById('stateGoal');
      const genreEl = document.getElementById('stateGenre');
      const linksEl = document.getElementById('stateLinks');
      return {
        goal: goalEl && goalEl.textContent !== '—' ? goalEl.textContent : null,
        genre: genreEl && genreEl.textContent !== '—' ? genreEl.textContent : null,
        linksCount: linksEl ? (parseInt(linksEl.textContent) || 0) : 0,
      };
    }

    function isSessionReady() {
      const { goal, genre, linksCount } = getSessionState();
      return !!goal && !!genre && linksCount >= 1;
    }

    function getSelectedScale() {
      const radio = document.querySelector('input[name="scale"]:checked');
      return radio ? radio.value : 'major';
    }

    function triggerStraightEcho() {
      if (!isSessionReady()) {
        addMessage('system', '⚠️ Please share your goal, genre, and at least one link first via voice or text.');
        return;
      }
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'trigger_manual', useDefaults: true }));
      disableGenerateButtons();
    }

    function triggerWithSettings() {
      if (!isSessionReady()) {
        addMessage('system', '⚠️ Please share your goal, genre, and at least one link first via voice or text.');
        return;
      }
      if (!ws || ws.readyState !== 1) return;
      const scalePreference = getSelectedScale();
      const density = parseFloat(document.getElementById('densitySlider').value);
      const brightness = parseFloat(document.getElementById('brightnessSlider').value);
      ws.send(JSON.stringify({ type: 'trigger_manual', scalePreference, density, brightness }));
      disableGenerateButtons();
    }

    function disableGenerateButtons() {
      document.getElementById('btnStraightEcho').disabled = true;
      document.getElementById('btnGenerateSettings').disabled = true;
    }

    function enableGenerateButtons() {
      document.getElementById('btnStraightEcho').disabled = false;
      document.getElementById('btnGenerateSettings').disabled = false;
    }

    // ── Boot ───────────────────────────────────────────────────────
    connect();
  </script>
</body>
</html>`);
});

// =============================================================
// PAGE: Demo Form — judges can generate without Telegram
// =============================================================
app.get('/demo', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Try Echo — Demo</title>
  ${getFontLinks()}
  <style>
    ${getBaseStyles()}

    .demo-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: calc(100vh - 80px);
      padding: 3rem 1.5rem;
    }

    .demo-header {
      text-align: center;
      margin-bottom: 2.5rem;
    }

    .demo-header h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
    }

    .demo-header p {
      color: var(--text-muted);
      font-size: 0.95rem;
      max-width: 460px;
    }

    .demo-form {
      width: 100%;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .field label {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
    }

    .field input,
    .field select,
    .field textarea {
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text);
      font-family: 'Inter', sans-serif;
      font-size: 0.95rem;
      padding: 0.75rem 1rem;
      transition: border-color 0.15s ease;
      outline: none;
      resize: vertical;
    }

    .field input:focus,
    .field select:focus,
    .field textarea:focus {
      border-color: var(--accent-border);
    }

    .field textarea {
      min-height: 120px;
    }

    .field .hint {
      font-size: 0.75rem;
      color: var(--text-subtle);
    }

    .submit-row {
      display: flex;
      gap: 1rem;
      align-items: center;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }

    @media (max-width: 480px) {
      .demo-container { padding: 2rem 1rem; }
      .demo-header h1 { font-size: 1.5rem; }
      .submit-row { flex-direction: column; align-items: stretch; }
      .submit-row .btn-primary { width: 100%; justify-content: center; }
    }

    #errorMsg {
      color: #e05;
      font-size: 0.85rem;
      display: none;
    }

    .genre-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .genre-chip {
      padding: 0.35rem 0.85rem;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 500;
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }

    .genre-chip:hover,
    .genre-chip.selected {
      background: var(--accent-dim);
      border-color: var(--accent-border);
      color: var(--accent);
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <div class="nav-links">
      <a href="/library" class="nav-link">Library</a>
      <a href="/live" class="btn-secondary" style="font-size:0.85rem;padding:0.5rem 1rem;">Try Voice</a>
    </div>
  </nav>

  <main class="demo-container">
    <div class="demo-header">
      <h1><span class="gradient-text">Try Echo</span></h1>
      <p>Enter your learning goal, pick a genre, and paste some links. Echo will generate a personalized track in about 60 seconds.</p>
    </div>

    <form class="demo-form glass" style="padding: 2rem;" id="demoForm">
      <div class="field">
        <label for="goal">What are you learning?</label>
        <input
          type="text"
          id="goal"
          name="goal"
          placeholder="e.g. Large language model architectures"
          required
          maxlength="200"
        >
      </div>

      <div class="field">
        <label>Music Genre</label>
        <div class="genre-grid" id="genreGrid">
          ${['Jazz', 'Lo-Fi', 'Hip-Hop', 'Electronic', 'Classical', 'Rock', 'Pop', 'Ambient'].map(g =>
            `<button type="button" class="genre-chip" data-genre="${g}">${g}</button>`
          ).join('')}
        </div>
        <input type="hidden" id="genre" name="genre" required>
      </div>

      <div class="field">
        <label for="links">Source Links</label>
        <textarea
          id="links"
          name="links"
          placeholder="Paste URLs here, one per line&#10;https://example.com/article&#10;https://youtube.com/watch?v=..."
          required
        ></textarea>
        <span class="hint">1–5 URLs supported. YouTube, articles, Twitter/X all work.</span>
      </div>

      <div class="submit-row">
        <button type="submit" class="btn-primary" id="submitBtn">
          Generate My Track
        </button>
        <span id="errorMsg"></span>
      </div>
    </form>
  </main>

  <script>
    // Genre chip selection
    const genreGrid = document.getElementById('genreGrid');
    const genreInput = document.getElementById('genre');
    let selectedGenre = '';

    genreGrid.querySelectorAll('.genre-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        genreGrid.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedGenre = chip.dataset.genre;
        genreInput.value = selectedGenre;
      });
    });

    // Form submission
    document.getElementById('demoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorMsg = document.getElementById('errorMsg');
      errorMsg.style.display = 'none';

      const goal = document.getElementById('goal').value.trim();
      const genre = genreInput.value.trim();
      const linksRaw = document.getElementById('links').value.trim();

      if (!goal) { errorMsg.textContent = 'Please enter a learning goal.'; errorMsg.style.display = ''; return; }
      if (!genre) { errorMsg.textContent = 'Please select a genre.'; errorMsg.style.display = ''; return; }
      if (!linksRaw) { errorMsg.textContent = 'Please paste at least one URL.'; errorMsg.style.display = ''; return; }

      const links = linksRaw.split(/\\n|\\r/).map(l => l.trim()).filter(l => l.startsWith('http'));
      if (links.length === 0) { errorMsg.textContent = 'No valid URLs found. Make sure links start with http.'; errorMsg.style.display = ''; return; }

      const submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Starting pipeline...';

      try {
        const resp = await fetch('/api/demo-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal, genre, links }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.chatId) throw new Error(data.error || 'Unknown error');
        window.location.href = '/digest/' + data.chatId;
      } catch (err) {
        errorMsg.textContent = 'Error: ' + err.message;
        errorMsg.style.display = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Generate My Track';
      }
    });
  </script>
</body>
</html>`);
});

// =============================================================
// API: Demo generation — create session + trigger pipeline
// =============================================================
app.post('/api/demo-generate', async (req, res) => {
  const { goal, genre, links } = req.body || {};

  if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
    return res.status(400).json({ error: 'goal is required' });
  }
  if (!genre || typeof genre !== 'string' || genre.trim().length === 0) {
    return res.status(400).json({ error: 'genre is required' });
  }
  if (!Array.isArray(links) || links.length === 0) {
    return res.status(400).json({ error: 'at least one link is required' });
  }

  const validLinks = links
    .filter(l => typeof l === 'string')
    .map(l => l.trim())
    .filter(l => /^https?:\/\//i.test(l))
    .slice(0, 5);

  if (validLinks.length === 0) {
    return res.status(400).json({ error: 'no valid http/https URLs provided' });
  }

  const chatId = 'demo_' + Date.now();

  try {
    await updateSession(chatId, {
      chatId,
      username: 'Demo User',
      goal: goal.trim().slice(0, 200),
      genre: genre.trim().slice(0, 50),
      links: validLinks,
      status: 'processing',
      createdAt: new Date().toISOString(),
    });

    // Fire and forget — SSE will stream progress to the client
    runGenerationPipeline(chatId, null).catch(err =>
      console.error('[Demo] Pipeline error for', chatId, err)
    );

    return res.json({ chatId });
  } catch (err) {
    console.error('[Demo] Failed to start pipeline:', err);
    return res.status(500).json({ error: 'Failed to start generation pipeline' });
  }
});

// =============================================================
// PAGE: Library — browse all past generated tracks
// =============================================================
app.get('/library', async (req, res) => {
  try {
    const sessions = await listSessions(50);

    const cardsHtml = sessions.length === 0
      ? `<div class="empty-state">
           <p style="font-size:2rem;margin-bottom:1rem;">🎵</p>
           <p>No tracks yet. Generate your first one!</p>
           <a href="/live" class="btn-primary" style="margin-top:1.5rem;">Start Creating</a>
         </div>`
      : sessions.map(s => {
          const r = s.generation_results || {};
          const dna = r.musical_dna || {};
          const cover = safeUrl(r.image_url) || '/assets/logo.png';
          const title = escapeHtml(r.track_title || s.goal || 'Untitled Track');
          const goal = escapeHtml(s.goal || '');
          const date = s.createdAt
            ? new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '';
          const bpm = escapeHtml(dna.bpm || '');
          const mood = escapeHtml(dna.mood || '');
          const key = escapeHtml(dna.key || '');
          return `
            <a href="/digest/${escapeHtml(s.id)}" class="track-card glass">
              <div class="track-cover">
                <img src="${cover}" alt="${title}" loading="lazy" onerror="this.src='/assets/logo.png'">
                <div class="play-overlay">▶</div>
              </div>
              <div class="track-info">
                <h3 class="track-title">${title}</h3>
                ${goal ? `<p class="track-goal">${goal}</p>` : ''}
                <div class="track-tags">
                  ${bpm ? `<span class="dna-tag">${bpm} BPM</span>` : ''}
                  ${mood ? `<span class="dna-tag">${mood}</span>` : ''}
                  ${key ? `<span class="dna-tag">${key}</span>` : ''}
                </div>
                ${date ? `<p class="track-date">${date}</p>` : ''}
              </div>
            </a>`;
        }).join('');

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Library — Echo</title>
  ${getFontLinks()}
  <style>
    ${getBaseStyles()}

    .library-header {
      padding: 3rem 0 2rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 2.5rem;
    }

    .library-header h1 {
      font-size: 2rem;
      font-weight: 700;
    }

    .library-header p {
      color: var(--text-muted);
      margin-top: 0.5rem;
    }

    .tracks-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1.25rem;
    }

    .track-card {
      display: block;
      text-decoration: none;
      color: inherit;
      border-radius: 14px;
      overflow: hidden;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .track-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }

    .track-cover {
      position: relative;
      aspect-ratio: 1;
      background: var(--surface-2);
      overflow: hidden;
    }

    .track-cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .play-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      opacity: 0;
      transition: opacity 0.15s ease;
      color: #fff;
    }

    .track-card:hover .play-overlay { opacity: 1; }

    .track-info {
      padding: 1rem;
    }

    .track-title {
      font-size: 0.95rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 0.35rem;
    }

    .track-goal {
      font-size: 0.8rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 0.5rem;
    }

    .track-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-bottom: 0.5rem;
    }

    .dna-tag {
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      background: var(--accent-dim);
      border: 1px solid var(--accent-border);
      border-radius: 999px;
      color: var(--accent);
      font-weight: 500;
    }

    .track-date {
      font-size: 0.75rem;
      color: var(--text-subtle);
    }

    .empty-state {
      grid-column: 1 / -1;
      text-align: center;
      padding: 5rem 2rem;
      color: var(--text-muted);
    }

    @media (max-width: 480px) {
      .library-header { padding: 2rem 0 1.5rem; }
      .library-header h1 { font-size: 1.5rem; }
      .tracks-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.875rem; }
    }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">
      <img src="/assets/logo.png" alt="Echo" class="logo-img">
      <span class="nav-brand-text gradient-text">ECHO</span>
    </a>
    <div class="nav-links">
      <a href="/library" class="nav-link active">Library</a>
      <a href="/live" class="btn-secondary" style="font-size:0.85rem;padding:0.5rem 1rem;">+ New Track</a>
    </div>
  </nav>

  <main class="container">
    <div class="library-header">
      <h1>Your <span class="gradient-text">Library</span></h1>
      <p>${sessions.length} track${sessions.length !== 1 ? 's' : ''} generated</p>
    </div>
    <div class="tracks-grid">
      ${cardsHtml}
    </div>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error('[Library] Error:', err);
    res.status(500).send(renderErrorPage());
  }
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

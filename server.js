/**
 * Express server — web dashboard + Telegram webhook endpoint.
 * 4-page flow matching wireframes: Landing → Dashboard → Processing → Result
 */
const express = require('express');
const path = require('path');
const { getSession } = require('./db');
const { bot } = require('./bot');

const app = express();

// --- Middleware ---
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// --- Telegram Webhook ---
app.use(bot.webhookCallback('/webhook'));

// --- Shared Styles & Layout ---
function getBaseStyles() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Animated gradient background */
    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background:
        radial-gradient(ellipse at 20% 50%, rgba(0, 207, 253, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(138, 43, 226, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse at 50% 80%, rgba(0, 207, 253, 0.05) 0%, transparent 50%);
      z-index: -1;
      animation: bgPulse 8s ease-in-out infinite alternate;
    }

    @keyframes bgPulse {
      0% { opacity: 0.6; }
      100% { opacity: 1; }
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    /* Glassmorphism card */
    .glass {
      background: rgba(255, 255, 255, 0.04);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
    }

    /* Gradient text */
    .gradient-text {
      background: linear-gradient(135deg, #00cffd, #8a2be2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    /* Echo branding */
    .logo-img {
      height: 60px;
      border-radius: 12px;
    }

    /* Buttons */
    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.875rem 2rem;
      background: linear-gradient(135deg, #00cffd, #8a2be2);
      color: white;
      font-weight: 600;
      font-size: 1rem;
      border: none;
      border-radius: 14px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.3s ease;
      box-shadow: 0 4px 20px rgba(0, 207, 253, 0.25);
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(0, 207, 253, 0.4);
    }

    .btn-secondary {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.875rem 2rem;
      background: rgba(255, 255, 255, 0.06);
      color: #e0e0e0;
      font-weight: 600;
      font-size: 1rem;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 14px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.3s ease;
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(0, 207, 253, 0.4);
      transform: translateY(-2px);
    }

    /* Nav bar */
    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 2rem;
      background: rgba(10, 10, 15, 0.8);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
    }

    .nav-brand-text {
      font-size: 1.25rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
  `;
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
      width: 220px;
      height: auto;
      border-radius: 24px;
      margin-bottom: 2rem;
      animation: logoFloat 3s ease-in-out infinite;
      box-shadow: 0 20px 60px rgba(0, 207, 253, 0.2);
    }

    @keyframes logoFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-12px); }
    }

    .hero h1 {
      font-size: 3.5rem;
      font-weight: 900;
      letter-spacing: -0.03em;
      margin-bottom: 1rem;
      line-height: 1.1;
    }

    .hero p {
      font-size: 1.2rem;
      color: rgba(255, 255, 255, 0.5);
      max-width: 500px;
      margin-bottom: 2.5rem;
      line-height: 1.6;
    }

    .hero .btn-primary {
      font-size: 1.15rem;
      padding: 1rem 2.5rem;
    }

    /* Floating particles */
    .particles {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: -1;
    }

    .particle {
      position: absolute;
      width: 4px; height: 4px;
      background: rgba(0, 207, 253, 0.3);
      border-radius: 50%;
      animation: particleFloat linear infinite;
    }

    @keyframes particleFloat {
      0% { transform: translateY(100vh) scale(0); opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { transform: translateY(-10vh) scale(1); opacity: 0; }
    }

    @media (max-width: 768px) {
      .hero h1 { font-size: 2.2rem; }
      .hero p { font-size: 1rem; }
      .hero-logo { width: 160px; }
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
    <a href="https://t.me/${botUsername}" class="btn-primary" target="_blank">
      🎧 Get Started with Telegram
    </a>
  </main>

  <div class="particles" id="particles"></div>
  <script>
    // Generate floating particles
    const container = document.getElementById('particles');
    for (let i = 0; i < 30; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (6 + Math.random() * 8) + 's';
      p.style.animationDelay = Math.random() * 6 + 's';
      p.style.width = p.style.height = (2 + Math.random() * 4) + 'px';
      if (Math.random() > 0.5) p.style.background = 'rgba(138, 43, 226, 0.3)';
      container.appendChild(p);
    }
  </script>
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
      <div class="link-item glass" style="padding: 1rem 1.25rem; margin-bottom: 0.5rem; border-radius: 12px; display: flex; align-items: center; gap: 0.75rem;">
        <span style="color: rgba(0,207,253,0.6); font-size: 0.85rem; font-weight: 600;">${String(i + 1).padStart(2, '0')}</span>
        <a href="${link}" target="_blank" style="color: #e0e0e0; text-decoration: none; word-break: break-all; font-size: 0.9rem; opacity: 0.8; transition: opacity 0.2s;"
           onmouseover="this.style.opacity='1';this.style.color='#00cffd'" onmouseout="this.style.opacity='0.8';this.style.color='#e0e0e0'">
          ${link}
        </a>
      </div>`)
    .join('') || '<p style="color: rgba(255,255,255,0.3); text-align: center; padding: 2rem;">No links queued yet. Send links via Telegram!</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Playlist — Echo</title>
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
    .links-list::-webkit-scrollbar-thumb { background: rgba(0,207,253,0.3); border-radius: 4px; }

    .profile-panel {
      padding: 2rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      text-align: center;
    }

    .avatar {
      width: 80px; height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, #00cffd, #8a2be2);
      display: flex; align-items: center; justify-content: center;
      font-size: 2rem; font-weight: 800; color: white;
    }

    .meta-tag {
      display: inline-block;
      padding: 0.4rem 0.75rem;
      background: rgba(0, 207, 253, 0.1);
      border: 1px solid rgba(0, 207, 253, 0.2);
      border-radius: 8px;
      font-size: 0.8rem;
      color: #00cffd;
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

  <div class="container">
    <div class="dashboard">
      <div class="links-panel glass">
        <h2>🔗 Links Consumed</h2>
        <div class="links-list">${linksHtml}</div>
      </div>

      <div class="profile-panel glass">
        <div class="avatar">${(session.username || '?')[0].toUpperCase()}</div>
        <h3 style="font-weight: 700;">${session.username || 'User'}</h3>

        <div>
          <p style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.4); margin-bottom: 0.5rem;">Daily Goal</p>
          <span class="meta-tag">${session.goal || 'Not set'}</span>
        </div>

        <div>
          <p style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.4); margin-bottom: 0.5rem;">Genre</p>
          <span class="meta-tag">${session.genre || 'Not set'}</span>
        </div>

        <div class="generate-area">
          <a href="https://t.me/${botUsername}?start=generate" class="btn-primary" style="width: 100%; justify-content: center;">
            🎵 Generate Today's Track!
          </a>
        </div>
      </div>
    </div>
  </div>
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
      font-size: 2rem;
      font-weight: 800;
      margin-top: 2.5rem;
      margin-bottom: 0.75rem;
    }

    .processing p {
      color: rgba(255, 255, 255, 0.4);
      font-size: 1rem;
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
      background: linear-gradient(135deg, #00cffd, #8a2be2);
      box-shadow: 0 0 40px rgba(0, 207, 253, 0.4);
    }

    .wave-ring .ring {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      border: 2px solid rgba(0, 207, 253, 0.3);
      animation: ringPulse 2s ease-out infinite;
    }

    .wave-ring .ring:nth-child(2) { animation-delay: 0.4s; }
    .wave-ring .ring:nth-child(3) { animation-delay: 0.8s; }
    .wave-ring .ring:nth-child(4) { animation-delay: 1.2s; }
    .wave-ring .ring:nth-child(5) { animation-delay: 1.6s; }

    @keyframes ringPulse {
      0% { width: 80px; height: 80px; opacity: 1; border-color: rgba(0, 207, 253, 0.6); }
      100% { width: 220px; height: 220px; opacity: 0; border-color: rgba(138, 43, 226, 0.1); }
    }

    /* Equalizer bars */
    .equalizer {
      display: flex;
      gap: 4px;
      align-items: flex-end;
      height: 40px;
      margin-top: 2rem;
    }

    .eq-bar {
      width: 4px;
      border-radius: 2px;
      background: linear-gradient(to top, #00cffd, #8a2be2);
      animation: eqBounce 1s ease-in-out infinite alternate;
    }

    @keyframes eqBounce {
      0% { height: 8px; }
      100% { height: 40px; }
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
    <p>Mixing ${(session.links || []).length} source(s) into your ${session.genre || 'custom'} track.</p>
    <p style="margin-top: 0.5rem; font-size: 0.85rem;">This page auto-refreshes every 15 seconds.</p>

    <div class="equalizer">
      ${Array.from({ length: 12 }, (_, i) =>
        `<div class="eq-bar" style="animation-delay: ${i * 0.1}s; animation-duration: ${0.6 + Math.random() * 0.8}s;"></div>`
      ).join('')}
    </div>
  </main>
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
      font-size: 1rem;
      line-height: 2;
      color: rgba(255, 255, 255, 0.65);
      transition: color 0.2s;
    }

    .lyric-line:hover {
      color: #00cffd;
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
      letter-spacing: 0.12em;
      color: rgba(255, 255, 255, 0.35);
      margin-bottom: 0.3rem;
    }

    .dna-value {
      font-size: 1.1rem;
      font-weight: 700;
      color: #00cffd;
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

  <div class="container">
    <div class="result">
      <!-- Left: Album Art + Player -->
      <div class="album-panel glass">
        ${hasVideo ? `
        <video autoplay loop muted playsinline class="album-cover" poster="${results.image_url || '/assets/echo_logo.jpg'}">
          <source src="${results.video_url}" type="video/mp4">
        </video>
        ` : `
        <img src="${results.image_url || '/assets/echo_logo.jpg'}" alt="Album Cover" class="album-cover" />
        `}

        ${hasAudio ? `
        <audio controls preload="metadata" id="audioPlayer">
          <source src="${results.audio_url}" type="audio/wav">
          Your browser does not support the audio element.
        </audio>

        <div class="controls">
          <button class="btn-primary" onclick="document.getElementById('audioPlayer').play()">▶ Play</button>
          <a href="${results.audio_url}" download="echo-track.wav" class="btn-secondary">⬇ Download</a>
        </div>
        ` : `
        <div class="controls">
          <div class="btn-secondary" style="flex: 1; justify-content: center; opacity: 0.5; cursor: default;">
            🎵 Audio generation in progress...
          </div>
        </div>
        `}
      </div>

      <!-- Right: Lyrics + Musical DNA -->
      <div class="info-panel">
        <div class="lyrics-card glass">
          <h2>📝 Lyrics</h2>
          <div class="lyrics-container">${lyricsHtml}</div>
        </div>

        <div class="dna-card glass">
          <h3>🧬 <span class="gradient-text">Musical DNA</span></h3>
          <div class="dna-grid">
            <div class="dna-item">
              <div class="dna-label">BPM</div>
              <div class="dna-value">${dna.bpm || '—'}</div>
            </div>
            <div class="dna-item">
              <div class="dna-label">Mood</div>
              <div class="dna-value">${dna.mood || '—'}</div>
            </div>
            <div class="dna-item">
              <div class="dna-label">Key</div>
              <div class="dna-value">${dna.key || '—'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
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
    .error-page p { color: rgba(255,255,255,0.4); margin-bottom: 2rem; }
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
// Utility
// =============================================================
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { app };

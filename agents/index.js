/**
 * Echo Multi-Agent Orchestrator — ADK-style DAG execution.
 *
 * Agent Graph:
 *   ContentAnalystAgent
 *        ↓
 *   CreativeDirectorAgent
 *        ↓
 *   ArtistAgent (Imagen 4 + Lyria 3 in parallel)
 *        ↓
 *   VideographerAgent (Veo 3, sequential — needs cover image)
 *
 * Each agent is isolated, independently testable, and emits progress events.
 */
const EventEmitter = require('events');
const contentAnalyst = require('./content_analyst');
const creativeDirector = require('./creative_director');
const artist = require('./artist');
const videographer = require('./videographer');

// Singleton event bus for SSE pipeline progress updates
const pipelineEvents = new EventEmitter();
pipelineEvents.setMaxListeners(100); // Support many concurrent SSE connections

/**
 * Emit a progress event for a specific chat session.
 * @param {string} chatId
 * @param {{ stage: string, message: string, progress: number }} event
 */
function emitProgress(chatId, event) {
  pipelineEvents.emit(`progress:${chatId}`, event);
}

/**
 * Run the full multi-agent pipeline for a chat session.
 *
 * @param {{ chatId: string, goal: string, genre: string, links: string[] }} params
 * @returns {Promise<{
 *   lyrics, image_url, audio_url, video_url, musical_dna, image_prompt, track_title
 * }>}
 */
async function runAgentPipeline({ chatId, goal, genre, links }) {
  console.log(`[Orchestrator] ══════ Starting agent pipeline for chat ${chatId} ══════`);
  console.log(`[Orchestrator] Agents: ContentAnalyst → CreativeDirector → Artist + Videographer`);

  // ── Agent 1: Content Analyst ───────────────────────────────────────────────
  emitProgress(chatId, { stage: 'content_analyst', message: '🔍 Analyzing your sources...', progress: 10 });
  const contentAnalysis = await contentAnalyst.run({ links, goal });
  console.log(`[Orchestrator] ContentAnalystAgent complete. Themes: ${contentAnalysis.keyThemes?.join(', ')}`);

  // ── Agent 2: Creative Director ─────────────────────────────────────────────
  emitProgress(chatId, { stage: 'creative_director', message: '✍️ Writing lyrics & creative direction...', progress: 30 });
  const creativeResult = await creativeDirector.run({ goal, genre, contentAnalysis });
  console.log(`[Orchestrator] CreativeDirectorAgent complete. Track: "${creativeResult.track_title}"`);

  // ── Agent 3: Artist (parallel Imagen 4 + Lyria 3) ─────────────────────────
  emitProgress(chatId, { stage: 'artist', message: '🎨 Generating album cover & music track...', progress: 50 });
  const { coverResult, audioUrl } = await artist.run({
    imagePrompt: creativeResult.image_prompt,
    lyrics: creativeResult.lyrics,
    genre,
    musicalDna: creativeResult.musical_dna,
    musicDirection: creativeResult.music_direction,
    chatId,
  });
  console.log('[Orchestrator] ArtistAgent complete.');

  // ── Agent 4: Videographer (Veo 3) ─────────────────────────────────────────
  emitProgress(chatId, { stage: 'videographer', message: '🎬 Rendering music video with Veo 3...', progress: 75 });
  const videoUrl = await videographer.run({
    coverBase64: coverResult.base64,
    lyrics: creativeResult.lyrics,
    genre,
    chatId,
  });
  console.log('[Orchestrator] VideographerAgent complete.');

  emitProgress(chatId, { stage: 'complete', message: '🎧 Your track is ready!', progress: 100 });

  return {
    lyrics: creativeResult.lyrics,
    image_url: coverResult.url,
    audio_url: audioUrl,
    video_url: videoUrl,
    musical_dna: creativeResult.musical_dna || { bpm: '120', mood: 'Energetic', key: 'C Major' },
    image_prompt: creativeResult.image_prompt,
    track_title: creativeResult.track_title || 'Echo Track',
  };
}

module.exports = { runAgentPipeline, pipelineEvents };

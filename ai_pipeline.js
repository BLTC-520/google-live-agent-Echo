/**
 * AI Generation Pipeline — thin orchestration layer.
 *
 * Delegates all work to the multi-agent system in agents/index.js:
 *   ContentAnalystAgent → CreativeDirectorAgent → ArtistAgent → VideographerAgent
 *
 * This module handles:
 *   - Session state management (Firestore)
 *   - Telegram notifications
 *   - Top-level error handling
 *
 * For SSE progress updates, consumers subscribe to pipelineEvents from agents/index.js.
 */
const { getSession, updateSession } = require('./db');
const { runAgentPipeline, pipelineEvents } = require('./agents/index');

/**
 * Run the full generation pipeline for a chat session.
 * @param {string} chatId
 * @param {object|null} telegram  Telegraf telegram context (null for web-only sessions)
 */
async function runGenerationPipeline(chatId, telegram) {
  try {
    console.log(`[Pipeline] ══════ Starting for chat ${chatId} ══════`);

    const session = await getSession(chatId);
    const { goal, genre, links } = session;

    if (!links || links.length === 0) {
      console.error('[Pipeline] No links found for chat', chatId);
      return;
    }

    // Run multi-agent pipeline
    const results = await runAgentPipeline({ chatId, goal, genre, links });

    // Persist results
    await updateSession(chatId, {
      status: 'completed',
      generation_results: results,
    });

    console.log(`[Pipeline] ══════ COMPLETE for chat ${chatId} ══════`);

    // Notify via Telegram if available
    if (telegram) {
      const digestUrl = `${process.env.CLOUD_RUN_URL || 'http://localhost:8080'}/digest/${chatId}`;
      const emoji = results.video_url ? '🎬' : results.audio_url ? '🎵' : '📝';
      await telegram.sendMessage(
        chatId,
        `${emoji} Your track "${results.track_title || 'Echo Track'}" is mastered! Listen here:\n${digestUrl}`
      );
    }
  } catch (err) {
    console.error(`[Pipeline] FAILED for chat ${chatId}:`, err);

    try {
      await updateSession(chatId, { status: 'idle' });
    } catch (updateErr) {
      console.error('[Pipeline] Failed to reset status:', updateErr.message);
    }

    if (telegram) {
      try {
        await telegram.sendMessage(
          chatId,
          '😔 Something went wrong while mastering your track. Please try again with /generate_digest'
        );
      } catch (notifyErr) {
        console.error('[Pipeline] Failed to send error notification:', notifyErr.message);
      }
    }
  }
}

module.exports = { runGenerationPipeline, pipelineEvents };

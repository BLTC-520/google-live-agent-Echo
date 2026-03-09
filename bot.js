/**
 * Telegram Bot module — handles user interactions via webhooks.
 * Flow: /start → Goal → Genre → Send links → /generate_digest
 */
const { Telegraf } = require('telegraf');
const { getSession, updateSession, appendLink } = require('./db');
const { runGenerationPipeline } = require('./ai_pipeline');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

/**
 * /start — Begin the onboarding flow.
 * Asks for the user's learning goal first.
 */
bot.start(async (ctx) => {
  const chatId = String(ctx.chat.id);
  const username = ctx.from.username || ctx.from.first_name || 'friend';

  // Initialize or reset session
  await updateSession(chatId, {
    goal: '',
    genre: '',
    links: [],
    status: 'idle',
    username,
    generation_results: {
      lyrics: '',
      image_url: '',
      audio_url: '',
      musical_dna: { bpm: '', mood: '', key: '' },
      image_prompt: '',
    },
  });

  await ctx.reply(
    `🎧 Welcome to Echo, ${username}!\n\n` +
    `I turn the links you read into personalized music tracks.\n\n` +
    `First, what's your learning goal today?\n` +
    `(e.g., "Mastering smart contract audits", "Understanding AI trends")`
  );
});

/**
 * /generate_digest — Trigger the AI pipeline.
 */
bot.command('generate_digest', async (ctx) => {
  const chatId = String(ctx.chat.id);

  try {
    const session = await getSession(chatId);

    // Check if links exist
    if (!session.links || session.links.length === 0) {
      return ctx.reply(
        "You haven't queued any tracks! Send me some links first. 🎵\n\n" +
        "Just paste any URL — articles, YouTube videos, tweets — and I'll add them to your playlist."
      );
    }

    // Check if already processing
    if (session.status === 'processing') {
      return ctx.reply(
        "🎧 I'm already in the booth mixing your track! Hold tight, I'll ping you when it's ready."
      );
    }

    // Update status to processing
    await updateSession(chatId, { status: 'processing' });

    // IMMEDIATE reply — crucial for Telegram timeout
    const digestUrl = `${process.env.CLOUD_RUN_URL || 'http://localhost:8080'}/digest/${chatId}`;
    await ctx.reply(
      `🎧 I'm stepping into the booth. This will take about 2 minutes.\n\n` +
      `Mixing ${session.links.length} source(s) into a ${session.genre || 'custom'} track...\n\n` +
      `🌐 Watch it cook:\n${digestUrl}\n\n` +
      `I'll ping you when the master track is ready!`
    );

    // Fire the pipeline asynchronously — do NOT await
    runGenerationPipeline(chatId, ctx.telegram).catch((err) => {
      console.error('[Bot] Background pipeline error:', err);
    });
  } catch (err) {
    console.error('[Bot] /generate_digest error:', err);
    await ctx.reply('Something went wrong. Please try again.');
  }
});

/**
 * /status — Check current session status.
 */
bot.command('status', async (ctx) => {
  const chatId = String(ctx.chat.id);

  try {
    const session = await getSession(chatId);

    if (session.status === 'completed') {
      const digestUrl = `${process.env.CLOUD_RUN_URL || 'http://localhost:8080'}/digest/${chatId}`;
      return ctx.reply(`🔥 Your track is ready! Listen here:\n${digestUrl}`);
    }

    if (session.status === 'processing') {
      return ctx.reply('🎧 Still mixing your track... I\'ll ping you when it\'s done!');
    }

    const linksCount = session.links ? session.links.length : 0;
    await ctx.reply(
      `📊 Session Status:\n` +
      `🎯 Goal: ${session.goal || '(not set)'}\n` +
      `🎵 Genre: ${session.genre || '(not set)'}\n` +
      `🔗 Links queued: ${linksCount}\n\n` +
      (linksCount > 0
        ? 'Type /generate_digest to drop the album!'
        : 'Send me some links to get started!')
    );
  } catch (err) {
    console.error('[Bot] /status error:', err);
    await ctx.reply('Could not fetch status. Please try again.');
  }
});

/**
 * Text message handler — handles Goal/Genre onboarding and URL collection.
 */
bot.on('text', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const text = ctx.message.text.trim();

  // Skip commands (they start with /)
  if (text.startsWith('/')) return;

  try {
    const session = await getSession(chatId);

    // --- Onboarding Flow ---

    // Step 1: If no goal is set, treat this message as the goal
    if (!session.goal) {
      await updateSession(chatId, { goal: text });
      return ctx.reply(
        `🎯 Goal locked in: "${text}"\n\n` +
        `Now, what genre should your track be?\n` +
        `(e.g., Lo-fi Hip Hop, Synthwave, Jazz, Indie Rock, Classical)`
      );
    }

    // Step 2: If no genre is set, treat this message as the genre
    if (!session.genre) {
      await updateSession(chatId, { genre: text });
      const digestUrl = `${process.env.CLOUD_RUN_URL || 'http://localhost:8080'}/digest/${chatId}`;
      return ctx.reply(
        `🎵 Genre set to: "${text}"\n\n` +
        `You're all set! Now send me links to articles, YouTube videos, or tweets.\n` +
        `I'll queue them up for your personalized track.\n\n` +
        `🌐 Your dashboard is live:\n${digestUrl}\n\n` +
        `When you're ready, type /generate_digest to drop the album! 🎧`
      );
    }

    // --- URL Collection ---

    // Check if the message contains a URL
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const urls = text.match(urlRegex);

    if (urls && urls.length > 0) {
      for (const url of urls) {
        await appendLink(chatId, url);
      }

      const totalLinks = (session.links ? session.links.length : 0) + urls.length;

      return ctx.reply(
        `🎵 ${urls.length > 1 ? `${urls.length} tracks` : 'Track'} queued!\n` +
        `📀 Total in playlist: ${totalLinks}\n\n` +
        `Send more, or type /generate_digest to drop the album.`
      );
    }

    // If it's just regular text (not a URL, goal/genre already set)
    await ctx.reply(
      `I'm looking for links! 🔗\n\n` +
      `Send me URLs to articles, YouTube videos, or tweets.\n` +
      `Or type /generate_digest if you're ready to create your track.`
    );
  } catch (err) {
    console.error('[Bot] Message handler error:', err);
    await ctx.reply('Something went wrong. Please try again.');
  }
});

module.exports = { bot };

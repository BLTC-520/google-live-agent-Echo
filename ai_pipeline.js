/**
 * AI Generation Pipeline — orchestrates scraping, Gemini, Imagen, and Music generation.
 * Runs asynchronously in the background after /generate_digest.
 */
const { GoogleGenAI } = require('@google/genai');
const { getSession, updateSession } = require('./db');
const { scrapeContent } = require('./scraper');

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Generate lyrics, image prompt, and musical DNA via Gemini 2.5.
 */
async function generateLyricsAndPrompt(goal, genre, scrapedText) {
  const prompt = `You are a talented songwriter and music producer. 

**Goal:** ${goal}
**Genre:** ${genre}
**Source Content:**
${scrapedText}

**Your Task:**
1. Write at least 14 lines of song lyrics that creatively summarize and distill the key ideas from the source content. The lyrics should fit the specified genre and goal. Make them catchy, meaningful, and emotionally resonant.
2. Provide a detailed visual prompt for generating an album cover image. The prompt should be vivid, artistic, and match the mood of the lyrics and genre.
3. Provide "Musical DNA" metadata for this track.

**IMPORTANT: Respond ONLY with valid JSON in this exact format, no markdown fences:**
{
  "lyrics": "Line 1\\nLine 2\\nLine 3\\n...",
  "image_prompt": "A detailed visual description for the album cover...",
  "musical_dna": {
    "bpm": "estimated BPM as a string, e.g. 92",
    "mood": "one or two word mood, e.g. Reflective",
    "key": "musical key, e.g. E Minor"
  }
}`;

  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  const rawText = response.text;
  if (!rawText) {
    console.error('[AI Pipeline] Gemini returned empty response');
    return {
      lyrics: 'The knowledge flows but words were lost in transit...',
      image_prompt: 'Abstract musical waveforms in neon cyan and purple on a dark background',
      musical_dna: { bpm: '120', mood: 'Energetic', key: 'C Major' },
    };
  }
  const text = rawText.trim();

  // Try to parse the JSON — handle potential markdown fences
  let cleaned = text;
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[AI Pipeline] Failed to parse Gemini response:', text);
    // Fallback: return the raw text as lyrics
    return {
      lyrics: text,
      image_prompt: 'Abstract musical waveforms in neon cyan and purple on a dark background',
      musical_dna: { bpm: '120', mood: 'Energetic', key: 'C Major' },
    };
  }
}

/**
 * Generate album cover image via Google Imagen API.
 * TODO: Replace stub with actual Imagen API call when available.
 */
async function generateAlbumCover(imagePrompt) {
  try {
    // Attempt to use Imagen via the GenAI SDK
    const response = await genai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: imagePrompt,
      config: {
        numberOfImages: 1,
      },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
      const imageBytes = response.generatedImages[0].image.imageBytes;
      // Return as a data URI for inline display
      return `data:image/png;base64,${imageBytes}`;
    }

    console.warn('[AI Pipeline] Imagen returned no images, using placeholder.');
    return '/assets/echo_logo.jpg';
  } catch (err) {
    console.error('[AI Pipeline] Imagen error:', err.message);
    // Fallback to logo as placeholder
    return '/assets/echo_logo.jpg';
  }
}

/**
 * Generate music track via Music Generation API.
 * TODO: Replace stub with actual Music API call when available.
 */
async function generateMusic(lyrics, genre) {
  try {
    // -------------------------------------------------------
    // STUB: Music generation API is not yet available.
    // When ready, replace this with the actual API call.
    // The function should return a URL to the generated .wav file.
    // -------------------------------------------------------
    console.warn('[AI Pipeline] Music generation stubbed — no API available yet.');
    return ''; // Empty string signals "no audio generated"
  } catch (err) {
    console.error('[AI Pipeline] Music generation error:', err.message);
    return '';
  }
}

/**
 * Main generation pipeline — called asynchronously after /generate_digest.
 * @param {string} chatId - Telegram chat ID
 * @param {Object} telegram - Telegraf telegram instance for sending notifications
 */
async function runGenerationPipeline(chatId, telegram) {
  try {
    console.log(`[AI Pipeline] Starting pipeline for chat ${chatId}`);

    // 1. Fetch session data
    const session = await getSession(chatId);
    const { goal, genre, links } = session;

    if (!links || links.length === 0) {
      console.error('[AI Pipeline] No links found for chat', chatId);
      return;
    }

    // 2. Scrape all content
    console.log(`[AI Pipeline] Scraping ${links.length} link(s)...`);
    const scrapedText = await scrapeContent(links);
    console.log(`[AI Pipeline] Scraped ${scrapedText.length} characters of content.`);

    // 3. Generate lyrics + image prompt + musical DNA via Gemini
    console.log('[AI Pipeline] Generating lyrics with Gemini...');
    const geminiResult = await generateLyricsAndPrompt(goal, genre, scrapedText);
    console.log('[AI Pipeline] Gemini generation complete.');

    // 4. Generate album cover via Imagen
    console.log('[AI Pipeline] Generating album cover...');
    const imageUrl = await generateAlbumCover(geminiResult.image_prompt);

    // 5. Generate music track
    console.log('[AI Pipeline] Generating music track...');
    const audioUrl = await generateMusic(geminiResult.lyrics, genre);

    // 6. Save results to Firestore
    const generationResults = {
      lyrics: geminiResult.lyrics,
      image_url: imageUrl,
      audio_url: audioUrl,
      musical_dna: geminiResult.musical_dna || { bpm: '120', mood: 'Energetic', key: 'C Major' },
      image_prompt: geminiResult.image_prompt,
    };

    await updateSession(chatId, {
      status: 'completed',
      generation_results: generationResults,
    });

    console.log(`[AI Pipeline] Pipeline complete for chat ${chatId}`);

    // 7. Notify user via Telegram
    if (telegram) {
      const digestUrl = `${process.env.CLOUD_RUN_URL || 'http://localhost:8080'}/digest/${chatId}`;
      await telegram.sendMessage(
        chatId,
        `🔥 Your track is mastered! Listen here: ${digestUrl}`
      );
    }
  } catch (err) {
    console.error(`[AI Pipeline] Pipeline failed for chat ${chatId}:`, err);

    // Update status to show error
    try {
      await updateSession(chatId, { status: 'idle' });
    } catch (updateErr) {
      console.error('[AI Pipeline] Failed to reset status:', updateErr.message);
    }

    // Notify user of failure
    if (telegram) {
      try {
        await telegram.sendMessage(
          chatId,
          '😔 Something went wrong while mastering your track. Please try again with /generate_digest'
        );
      } catch (notifyErr) {
        console.error('[AI Pipeline] Failed to send error notification:', notifyErr.message);
      }
    }
  }
}

module.exports = { runGenerationPipeline };

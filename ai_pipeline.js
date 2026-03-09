/**
 * AI Generation Pipeline — Multi-Modal Creative Storyteller
 * Stage 1: Gemini 2.5 Flash → lyrics, image prompt, musical DNA
 * Stage 2a: Imagen 4 → album cover image  (parallel)
 * Stage 2b: Lyria 3 → 30-second music track with vocals  (parallel)
 * Stage 3: Veo 3 → 6-second music video from album cover  (sequential)
 *
 * Auth: Vertex AI project-based (ADC on Cloud Run via Service Account)
 * Storage: Google Cloud Storage for all generated media
 */
const { GoogleGenAI } = require('@google/genai');
const { GoogleAuth } = require('google-auth-library');
const { Storage } = require('@google-cloud/storage');
const { getSession, updateSession } = require('./db');
const { scrapeContent } = require('./scraper');

// ── Config ──────────────────────────────────────────────────────────
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_REGION || 'us-central1';
const GCS_BUCKET = process.env.GCS_BUCKET || `${PROJECT_ID}-echo-media`;

// ── Clients ─────────────────────────────────────────────────────────
// Vertex AI client for Imagen 4 (uses ADC)
const vertexClient = new GoogleGenAI({
  vertexai: true,
  project: PROJECT_ID,
  location: LOCATION,
});

// Gemini client for text generation (API key — faster, simpler)
const geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Google Auth for REST calls (Lyria, Veo)
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

// GCS client for media uploads
const storage = new Storage({ projectId: PROJECT_ID });

// ════════════════════════════════════════════════════════════════════
// HELPER: Upload buffer to GCS, return public URL
// ════════════════════════════════════════════════════════════════════
async function uploadToGCS(buffer, fileName, contentType) {
  const bucket = storage.bucket(GCS_BUCKET);

  // Ensure bucket exists (create on first run)
  const [exists] = await bucket.exists();
  if (!exists) {
    await bucket.create({ location: LOCATION });
    console.log(`[GCS] Created bucket: ${GCS_BUCKET}`);
  }

  const file = bucket.file(fileName);
  await file.save(buffer, {
    contentType,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  // Make publicly readable
  await file.makePublic();

  return `https://storage.googleapis.com/${GCS_BUCKET}/${fileName}`;
}

// ════════════════════════════════════════════════════════════════════
// STAGE 1: Gemini 2.5 Flash → Lyrics + Image Prompt + Musical DNA
// ════════════════════════════════════════════════════════════════════
async function generateLyricsAndPrompt(goal, genre, scrapedText) {
  const prompt = `You are a talented songwriter and music producer.

**Goal:** ${goal}
**Genre:** ${genre}
**Source Content:**
${scrapedText}

**Your Task:**
1. Write at least 14 lines of song lyrics that creatively summarize and distill the key ideas from the source content. The lyrics should fit the specified genre and goal. Make them catchy, meaningful, and emotionally resonant.
2. Provide a detailed visual prompt for generating an album cover image with Imagen 4. The prompt should be vivid, artistic, and match the mood of the lyrics and genre. Do NOT include any text or words to be rendered in the image.
3. Provide "Musical DNA" metadata for this track.
4. Provide a short music production direction for the Lyria music model (instrumentation, tempo feel, vocal style).

**IMPORTANT: Respond ONLY with valid JSON in this exact format, no markdown fences:**
{
  "lyrics": "Line 1\\nLine 2\\nLine 3\\n...",
  "image_prompt": "A detailed visual description for the album cover...",
  "musical_dna": {
    "bpm": "estimated BPM as a string, e.g. 92",
    "mood": "one or two word mood, e.g. Reflective",
    "key": "musical key, e.g. E Minor"
  },
  "music_direction": "A short production note, e.g. Warm synth pads, lo-fi drums, soft female vocals, dreamy reverb"
}`;

  const response = await geminiClient.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  const rawText = response.text;
  if (!rawText) {
    console.error('[AI Pipeline] Gemini returned empty response');
    return getFallbackGeminiResult();
  }

  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[AI Pipeline] Failed to parse Gemini response:', cleaned.substring(0, 300));
    return {
      lyrics: cleaned,
      image_prompt: 'Abstract musical waveforms in neon cyan and purple on a dark background',
      musical_dna: { bpm: '120', mood: 'Energetic', key: 'C Major' },
      music_direction: 'Upbeat electronic, crisp drums, bright synths',
    };
  }
}

function getFallbackGeminiResult() {
  return {
    lyrics: 'The knowledge flows but words were lost in transit...',
    image_prompt: 'Abstract musical waveforms in neon cyan and purple on a dark background',
    musical_dna: { bpm: '120', mood: 'Energetic', key: 'C Major' },
    music_direction: 'Upbeat electronic, crisp drums, bright synths',
  };
}

// ════════════════════════════════════════════════════════════════════
// STAGE 2a: Imagen 4 → Album Cover
// ════════════════════════════════════════════════════════════════════
async function generateAlbumCover(imagePrompt, chatId) {
  try {
    console.log('[AI Pipeline] Calling Imagen 4...');
    const response = await vertexClient.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: imagePrompt,
      config: {
        aspectRatio: '1:1',
        numberOfImages: 1,
        safetyFilterLevel: 'BLOCK_MEDIUM_AND_ABOVE',
        personGeneration: 'ALLOW_ADULT',
      },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
      const imageBytes = response.generatedImages[0].image.imageBytes;
      const buffer = Buffer.from(imageBytes, 'base64');
      const fileName = `covers/${chatId}_${Date.now()}.png`;
      const url = await uploadToGCS(buffer, fileName, 'image/png');
      console.log('[AI Pipeline] Imagen 4 album cover generated & uploaded.');
      return { url, base64: imageBytes };
    }

    console.warn('[AI Pipeline] Imagen 4 returned no images, using placeholder.');
    return { url: '/assets/echo_logo.jpg', base64: null };
  } catch (err) {
    console.error('[AI Pipeline] Imagen 4 error:', err.message);
    return { url: '/assets/echo_logo.jpg', base64: null };
  }
}

// ════════════════════════════════════════════════════════════════════
// STAGE 2b: Lyria 3 → 30-Second Music Track with Vocals
// ════════════════════════════════════════════════════════════════════
async function generateMusic(lyrics, genre, musicalDna, musicDirection, chatId) {
  try {
    console.log('[AI Pipeline] Calling Lyria 3...');

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;

    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/lyria-003:predict`;

    const bpm = parseInt(musicalDna?.bpm) || 120;
    const prompt = `A ${genre} track. ${musicDirection || ''}. Lyrics: ${lyrics}. Style: Professional production, catchy melody, ${musicalDna?.mood || 'energetic'} mood.`;

    const payload = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        durationSeconds: 30,
        musicGenerationMode: 'VOCALIZATION',
        bpm: bpm,
      },
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Lyria API ${res.status}: ${errorBody.substring(0, 300)}`);
    }

    const data = await res.json();
    const audioBase64 = data.predictions?.[0]?.bytesBase64Encoded;

    if (audioBase64) {
      const buffer = Buffer.from(audioBase64, 'base64');
      const fileName = `tracks/${chatId}_${Date.now()}.wav`;
      const url = await uploadToGCS(buffer, fileName, 'audio/wav');
      console.log(`[AI Pipeline] Lyria 3 music track generated & uploaded (${(buffer.length / 1024 / 1024).toFixed(1)}MB).`);
      return url;
    }

    console.warn('[AI Pipeline] Lyria 3 returned no audio data.');
    return '';
  } catch (err) {
    console.error('[AI Pipeline] Lyria 3 error:', err.message);
    return '';
  }
}

// ════════════════════════════════════════════════════════════════════
// STAGE 3: Veo 3 → 6-Second Music Video from Album Cover
// ════════════════════════════════════════════════════════════════════
async function generateMusicVideo(coverBase64, lyrics, genre, chatId) {
  try {
    if (!coverBase64) {
      console.warn('[AI Pipeline] No cover image available for Veo 3, skipping video.');
      return '';
    }

    console.log('[AI Pipeline] Calling Veo 3 (image-to-video)...');

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;

    // Use a short snippet of lyrics for the video prompt
    const lyricsSnippet = lyrics.split('\n').slice(0, 4).join('. ');
    const videoPrompt = `A cinematic, atmospheric music video for a ${genre} song. The album artwork slowly comes alive with subtle motion, light shifts, and gentle particle effects. The mood is ${genre}. ${lyricsSnippet}`;

    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/veo-3.1-generate-001:predictLongRunning`;

    const payload = {
      instances: [{
        prompt: videoPrompt,
        image: { bytesBase64Encoded: coverBase64 },
      }],
      parameters: {
        aspectRatio: '16:9',
        sampleCount: 1,
        durationSeconds: 6,
        resolution: '720p',
        personGeneration: 'allow_adult',
        enhancePrompt: true,
        generateAudio: true,
      },
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Veo 3 API ${res.status}: ${errorBody.substring(0, 300)}`);
    }

    // Veo returns a long-running operation — poll until done
    let operation = await res.json();
    const operationName = operation.name;
    console.log(`[AI Pipeline] Veo 3 operation started: ${operationName}`);

    const opsEndpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/${operationName}`;
    const maxWaitMs = 5 * 60 * 1000; // 5 minute timeout
    const startTime = Date.now();

    while (!operation.done) {
      if (Date.now() - startTime > maxWaitMs) {
        console.warn('[AI Pipeline] Veo 3 timed out after 5 minutes.');
        return '';
      }
      await new Promise((r) => setTimeout(r, 15000)); // Poll every 15s

      const pollRes = await fetch(opsEndpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      operation = await pollRes.json();
    }

    if (operation.error) {
      throw new Error(`Veo 3 operation error: ${JSON.stringify(operation.error)}`);
    }

    // Extract video bytes from the response
    const videoBase64 =
      operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.bytesBase64Encoded;

    if (videoBase64) {
      const buffer = Buffer.from(videoBase64, 'base64');
      const fileName = `videos/${chatId}_${Date.now()}.mp4`;
      const url = await uploadToGCS(buffer, fileName, 'video/mp4');
      console.log(`[AI Pipeline] Veo 3 music video generated & uploaded (${(buffer.length / 1024 / 1024).toFixed(1)}MB).`);
      return url;
    }

    console.warn('[AI Pipeline] Veo 3 returned no video data.');
    return '';
  } catch (err) {
    console.error('[AI Pipeline] Veo 3 error:', err.message);
    return ''; // Non-fatal — result page still shows static cover + audio
  }
}

// ════════════════════════════════════════════════════════════════════
// MAIN PIPELINE — orchestrates all 3 stages
// ════════════════════════════════════════════════════════════════════
async function runGenerationPipeline(chatId, telegram) {
  try {
    console.log(`[AI Pipeline] ══════ Starting pipeline for chat ${chatId} ══════`);

    // ── 1. Fetch session data ──────────────────────────────────────
    const session = await getSession(chatId);
    const { goal, genre, links } = session;

    if (!links || links.length === 0) {
      console.error('[AI Pipeline] No links found for chat', chatId);
      return;
    }

    // ── 2. Scrape all content ──────────────────────────────────────
    console.log(`[AI Pipeline] Scraping ${links.length} link(s)...`);
    const scrapedText = await scrapeContent(links);
    console.log(`[AI Pipeline] Scraped ${scrapedText.length} characters of content.`);

    // ── STAGE 1: Gemini 2.5 Flash ──────────────────────────────────
    console.log('[AI Pipeline] ── Stage 1: Gemini → Lyrics + Prompts ──');
    const geminiResult = await generateLyricsAndPrompt(goal, genre, scrapedText);
    console.log('[AI Pipeline] Stage 1 complete.');

    // ── STAGE 2: Imagen 4 + Lyria 3 (parallel) ────────────────────
    console.log('[AI Pipeline] ── Stage 2: Imagen 4 + Lyria 3 (parallel) ──');
    const [coverResult, audioUrl] = await Promise.all([
      generateAlbumCover(geminiResult.image_prompt, chatId),
      generateMusic(
        geminiResult.lyrics,
        genre,
        geminiResult.musical_dna,
        geminiResult.music_direction,
        chatId
      ),
    ]);
    console.log('[AI Pipeline] Stage 2 complete.');

    // ── STAGE 3: Veo 3 (sequential, needs cover image) ────────────
    console.log('[AI Pipeline] ── Stage 3: Veo 3 → Music Video ──');
    let videoUrl = '';
    if (coverResult.base64) {
      videoUrl = await generateMusicVideo(
        coverResult.base64,
        geminiResult.lyrics,
        genre,
        chatId
      );
    } else {
      console.warn('[AI Pipeline] Skipping Veo 3 — no cover image base64 available.');
    }
    console.log('[AI Pipeline] Stage 3 complete.');

    // ── 6. Save results to Firestore ───────────────────────────────
    const generationResults = {
      lyrics: geminiResult.lyrics,
      image_url: coverResult.url,
      audio_url: audioUrl,
      video_url: videoUrl,
      musical_dna: geminiResult.musical_dna || { bpm: '120', mood: 'Energetic', key: 'C Major' },
      image_prompt: geminiResult.image_prompt,
    };

    await updateSession(chatId, {
      status: 'completed',
      generation_results: generationResults,
    });

    console.log(`[AI Pipeline] ══════ Pipeline COMPLETE for chat ${chatId} ══════`);

    // ── 7. Notify user via Telegram ────────────────────────────────
    if (telegram) {
      const digestUrl = `${process.env.CLOUD_RUN_URL || 'http://localhost:8080'}/digest/${chatId}`;
      const hasAudio = audioUrl && audioUrl.length > 0;
      const hasVideo = videoUrl && videoUrl.length > 0;
      const mediaEmoji = hasVideo ? '🎬' : hasAudio ? '🎵' : '📝';
      await telegram.sendMessage(
        chatId,
        `${mediaEmoji} Your track is mastered! Listen here: ${digestUrl}`
      );
    }
  } catch (err) {
    console.error(`[AI Pipeline] Pipeline FAILED for chat ${chatId}:`, err);

    try {
      await updateSession(chatId, { status: 'idle' });
    } catch (updateErr) {
      console.error('[AI Pipeline] Failed to reset status:', updateErr.message);
    }

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

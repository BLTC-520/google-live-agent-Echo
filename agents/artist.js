/**
 * ArtistAgent — ADK-style agent for visual and audio creation.
 * Runs Imagen 4 (album cover) and Lyria 3 (music track) in parallel.
 */
const { GoogleGenAI } = require('@google/genai');
const { GoogleAuth } = require('google-auth-library');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const AGENT_DESCRIPTION =
  'Generates album cover art (Imagen 4) and music track (Lyria RealTime) in parallel';

const PROJECT_ID = () => process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = () => process.env.GOOGLE_CLOUD_REGION || 'us-central1';
const GCS_BUCKET = () => process.env.GCS_BUCKET || `${PROJECT_ID()}-echo-media`;

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

// Vertex AI client for Imagen 4
const vertexClient = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_REGION || 'us-central1',
});

// ── GCS upload helper ────────────────────────────────────────────────
async function uploadToGCS(buffer, fileName, contentType) {
  const storage = new Storage({ projectId: PROJECT_ID() });
  const bucket = storage.bucket(GCS_BUCKET());

  const [exists] = await bucket.exists();
  if (!exists) {
    await bucket.create({ location: LOCATION() });
    console.log(`[ArtistAgent] Created GCS bucket: ${GCS_BUCKET()}`);
  }

  const file = bucket.file(fileName);
  await file.save(buffer, {
    contentType,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  return `https://storage.googleapis.com/${GCS_BUCKET()}/${fileName}`;
}

// ── Imagen 4: Album Cover ────────────────────────────────────────────
async function generateAlbumCover(imagePrompt, chatId) {
  try {
    console.log('[ArtistAgent] Calling Imagen 4...');
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

    if (response.generatedImages?.length > 0) {
      const imageBytes = response.generatedImages[0].image.imageBytes;
      const buffer = Buffer.from(imageBytes, 'base64');
      const fileName = `covers/${chatId}_${Date.now()}.png`;
      const url = await uploadToGCS(buffer, fileName, 'image/png');
      console.log('[ArtistAgent] Album cover generated & uploaded.');
      return { url, base64: imageBytes };
    }

    console.warn('[ArtistAgent] Imagen 4 returned no images — using placeholder.');
    return { url: '/assets/logo.png', base64: null };
  } catch (err) {
    console.error('[ArtistAgent] Imagen 4 error:', err.message);
    return { url: '/assets/logo.png', base64: null };
  }
}

// ── WAV header builder (16-bit signed PCM, 48 kHz, stereo) ───────────
function buildWavBuffer(pcmBuffer, sampleRate = 48000, channels = 2, bitDepth = 16) {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);            // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// ── Lyria RealTime (Experimental): Music Track ───────────────────────
const TARGET_DURATION_SECS = 60;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BIT_DEPTH = 16;
const TARGET_PCM_BYTES = TARGET_DURATION_SECS * SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8); // ~11.5 MB

const SCALE_MAP = {
  'C Major': 'SCALE_C_MAJOR', 'A Minor': 'SCALE_A_MINOR',
  'G Major': 'SCALE_G_MAJOR', 'E Minor': 'SCALE_E_MINOR',
  'D Major': 'SCALE_D_MAJOR', 'B Minor': 'SCALE_B_MINOR',
  'A Major': 'SCALE_A_MAJOR', 'F# Minor': 'SCALE_F_SHARP_MINOR',
  'E Major': 'SCALE_E_MAJOR', 'C# Minor': 'SCALE_C_SHARP_MINOR',
  'F Major': 'SCALE_F_MAJOR', 'D Minor': 'SCALE_D_MINOR',
};

function resolveScale(scalePreference) {
  if (!scalePreference) return null;
  // Direct match (e.g. "A Minor")
  if (SCALE_MAP[scalePreference]) return SCALE_MAP[scalePreference];
  // Simple major/minor shorthand
  const lower = scalePreference.toLowerCase();
  if (lower === 'minor') return 'SCALE_A_MINOR';
  if (lower === 'major') return 'SCALE_C_MAJOR';
  return null;
}

async function generateMusic(lyrics, genre, musicalDna, musicDirection, chatId, musicSettings = {}) {
  return new Promise((resolve) => {
    console.log('[ArtistAgent] Calling Lyria RealTime Experimental API...');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[ArtistAgent] No GEMINI_API_KEY found. Falling back.');
      resolve(useFallbackTrack(chatId));
      return;
    }

    const host = 'wss://generativelanguage.googleapis.com';
    const wsUrl = `${host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic?key=${apiKey}`;

    const ws = new WebSocket(wsUrl);
    let audioChunks = [];
    let totalPcmBytes = 0;
    let timeoutId;
    let isCompleted = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };

    const finishStream = async () => {
      if (isCompleted) return;
      isCompleted = true;
      cleanup();

      if (audioChunks.length === 0) {
        console.warn('[ArtistAgent] Lyria RealTime stream ended but no audio was received.');
        resolve(useFallbackTrack(chatId));
        return;
      }

      try {
        console.log(`[ArtistAgent] Lyria stream complete. Received ${audioChunks.length} chunks. Building WAV...`);
        const pcmBuffers = audioChunks.map(b64 => Buffer.from(b64, 'base64'));
        const pcmBuffer = Buffer.concat(pcmBuffers);
        const wavBuffer = buildWavBuffer(pcmBuffer);

        const fileName = `tracks/${chatId}_${Date.now()}.wav`;
        const url = await uploadToGCS(wavBuffer, fileName, 'audio/wav');
        console.log(`[ArtistAgent] Music track uploaded (${(wavBuffer.length / 1024 / 1024).toFixed(1)} MB).`);
        resolve(url);
      } catch (err) {
        console.error('[ArtistAgent] Failed to upload Lyria audio:', err.message);
        resolve(useFallbackTrack(chatId));
      }
    };

    ws.on('open', () => {
      console.log('[ArtistAgent] Lyria WebSocket connected. Sending setup...');

      // model must be included in setup — its absence causes the 404/rejection
      ws.send(JSON.stringify({
        setup: {
          model: 'models/lyria-realtime-exp',
        }
      }));

      timeoutId = setTimeout(() => {
        console.error('[ArtistAgent] Lyria generation timed out after 90s.');
        finishStream();
      }, 90000);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.setupComplete !== undefined) {
          console.log('[ArtistAgent] Lyria setup complete. Sending prompts + config + play...');

          const bpm = parseInt(musicalDna?.bpm) || 90;
          const promptText = [
            genre,
            musicDirection,
            musicalDna?.mood,
            lyrics ? `lyrics themes: ${lyrics}` : null,
          ].filter(Boolean).join(', ');

          // 1. Weighted prompts — SDK wraps these in clientContent
          ws.send(JSON.stringify({
            clientContent: {
              weightedPrompts: [{ text: promptText, weight: 1.0 }]
            }
          }));

          // 2. Music generation config — sent unwrapped
          const musicConfig = { bpm, temperature: 1.0 };
          const scale = resolveScale(musicSettings.scalePreference);
          if (scale) {
            musicConfig.scale = scale;
            console.log(`[ArtistAgent] scale: ${scale}`);
          }
          if (typeof musicSettings.density === 'number') musicConfig.density = musicSettings.density;
          if (typeof musicSettings.brightness === 'number') musicConfig.brightness = musicSettings.brightness;
          ws.send(JSON.stringify({ musicGenerationConfig: musicConfig }));

          // 3. Start streaming
          ws.send(JSON.stringify({ playbackControl: 'PLAY' }));
          return;
        }

        const serverContent = msg.serverContent;
        if (!serverContent) return;

        // Response schema: serverContent.audioChunks[].data (base64 PCM)
        const chunks = serverContent.audioChunks || [];
        for (const chunk of chunks) {
          if (chunk.data) {
            const chunkBytes = Buffer.from(chunk.data, 'base64').length;
            totalPcmBytes += chunkBytes;
            audioChunks.push(chunk.data);

            // Reset inactivity timeout on each received chunk
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              console.error('[ArtistAgent] Lyria timed out — no audio received for 30s.');
              finishStream();
            }, 30000);

            // Stop once we have ~1 minute of audio
            if (totalPcmBytes >= TARGET_PCM_BYTES) {
              const secs = (totalPcmBytes / (SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8))).toFixed(1);
              console.log(`[ArtistAgent] Reached ${secs}s of audio. Sending PAUSE.`);
              ws.send(JSON.stringify({ playbackControl: 'PAUSE' }));
              finishStream();
              return;
            }
          }
        }

        if (serverContent.turnComplete) {
          console.log('[ArtistAgent] Server marked turn as complete.');
          finishStream();
        }

      } catch (err) {
        console.error('[ArtistAgent] WebSocket parse error:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error('[ArtistAgent] Lyria WebSocket error:', err.message);
      finishStream();
    });

    ws.on('close', (code) => {
      console.log(`[ArtistAgent] Lyria WebSocket closed (code ${code}).`);
      finishStream();
    });
  });
}

async function useFallbackTrack(chatId) {
  try {
    const fallbackPath = path.join(__dirname, '..', 'assets', 'Immutable_Code.mp3');
    const buffer = fs.readFileSync(fallbackPath);
    const fileName = `tracks/${chatId}_fallback_${Date.now()}.mp3`;
    const url = await uploadToGCS(buffer, fileName, 'audio/mpeg');
    console.log('[ArtistAgent] Fallback track uploaded.');
    return url;
  } catch (err) {
    console.error('[ArtistAgent] Fallback upload failed:', err.message);
    return '/assets/Immutable_Code.mp3';
  }
}

/**
 * @param {{ imagePrompt, lyrics, genre, musicalDna, musicDirection, chatId, musicSettings? }} params
 * @returns {Promise<{ coverResult: { url, base64 }, audioUrl: string }>}
 */
async function run({ imagePrompt, lyrics, genre, musicalDna, musicDirection, chatId, musicSettings = {} }) {
  console.log('[ArtistAgent] Running Imagen 4 + Lyria 3 in parallel...');

  const [coverResult, audioUrl] = await Promise.all([
    generateAlbumCover(imagePrompt, chatId),
    generateMusic(lyrics, genre, musicalDna, musicDirection, chatId, musicSettings),
  ]);

  console.log('[ArtistAgent] Parallel generation complete.');
  return { coverResult, audioUrl };
}

module.exports = { run, description: AGENT_DESCRIPTION };

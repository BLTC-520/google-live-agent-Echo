/**
 * ArtistAgent — ADK-style agent for visual and audio creation.
 * Runs Imagen 4 (album cover) and Lyria 3 (music track) in parallel.
 */
const { GoogleGenAI } = require('@google/genai');
const { GoogleAuth } = require('google-auth-library');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

const AGENT_DESCRIPTION =
  'Generates album cover art (Imagen 4) and music track (Lyria 3) in parallel';

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
    return { url: '/assets/echo_logo.jpg', base64: null };
  } catch (err) {
    console.error('[ArtistAgent] Imagen 4 error:', err.message);
    return { url: '/assets/echo_logo.jpg', base64: null };
  }
}

// ── Lyria 3: Music Track ─────────────────────────────────────────────
async function generateMusic(lyrics, genre, musicalDna, musicDirection, chatId) {
  try {
    console.log('[ArtistAgent] Calling Lyria 3...');

    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    const endpoint = `https://${LOCATION()}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID()}/locations/${LOCATION()}/publishers/google/models/lyria-003:predict`;

    const bpm = parseInt(musicalDna?.bpm) || 120;
    const prompt = `A ${genre} track. ${musicDirection || ''}. Lyrics: ${lyrics}. Style: Professional production, catchy melody, ${musicalDna?.mood || 'energetic'} mood.`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          durationSeconds: 30,
          musicGenerationMode: 'VOCALIZATION',
          bpm,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Lyria API ${res.status}: ${body.substring(0, 200)}`);
    }

    const data = await res.json();
    const audioBase64 = data.predictions?.[0]?.bytesBase64Encoded;

    if (audioBase64) {
      const buffer = Buffer.from(audioBase64, 'base64');
      const fileName = `tracks/${chatId}_${Date.now()}.wav`;
      const url = await uploadToGCS(buffer, fileName, 'audio/wav');
      console.log(`[ArtistAgent] Music track generated & uploaded (${(buffer.length / 1024 / 1024).toFixed(1)} MB).`);
      return url;
    }

    console.warn('[ArtistAgent] Lyria 3 returned no audio — using fallback track.');
    return useFallbackTrack(chatId);
  } catch (err) {
    console.error('[ArtistAgent] Lyria 3 error:', err.message);
    return useFallbackTrack(chatId);
  }
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
 * @param {{ imagePrompt, lyrics, genre, musicalDna, musicDirection, chatId }} params
 * @returns {Promise<{ coverResult: { url, base64 }, audioUrl: string }>}
 */
async function run({ imagePrompt, lyrics, genre, musicalDna, musicDirection, chatId }) {
  console.log('[ArtistAgent] Running Imagen 4 + Lyria 3 in parallel...');

  const [coverResult, audioUrl] = await Promise.all([
    generateAlbumCover(imagePrompt, chatId),
    generateMusic(lyrics, genre, musicalDna, musicDirection, chatId),
  ]);

  console.log('[ArtistAgent] Parallel generation complete.');
  return { coverResult, audioUrl };
}

module.exports = { run, description: AGENT_DESCRIPTION };

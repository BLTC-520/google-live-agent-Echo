/**
 * VideographerAgent — ADK-style agent that generates 6-second music videos.
 * Uses Veo 3 (image-to-video) via Vertex AI long-running operations API.
 */
const { GoogleAuth } = require('google-auth-library');
const { Storage } = require('@google-cloud/storage');

const AGENT_DESCRIPTION =
  'Generates cinematic music videos from album cover art using Veo 3';

const PROJECT_ID = () => process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = () => process.env.GOOGLE_CLOUD_REGION || 'us-central1';
const GCS_BUCKET = () => process.env.GCS_BUCKET || `${PROJECT_ID()}-echo-media`;

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

async function uploadToGCS(buffer, fileName, contentType) {
  const storage = new Storage({ projectId: PROJECT_ID() });
  const bucket = storage.bucket(GCS_BUCKET());
  const file = bucket.file(fileName);
  await file.save(buffer, {
    contentType,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${GCS_BUCKET()}/${fileName}`;
}

/**
 * @param {{ coverBase64, lyrics, genre, chatId }} params
 * @returns {Promise<string>} Video URL or empty string on failure
 */
async function run({ coverBase64, lyrics, genre, chatId }) {
  if (!coverBase64) {
    console.warn('[VideographerAgent] No album cover base64 — skipping Veo 3.');
    return '';
  }

  try {
    console.log('[VideographerAgent] Calling Veo 3 (image-to-video)...');

    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    const lyricsSnippet = lyrics.split('\n').slice(0, 4).join('. ');
    const videoPrompt = `A cinematic, atmospheric ${genre} music video. The album artwork slowly comes alive with subtle motion, light shifts, and gentle particle effects. The mood matches ${genre} music. ${lyricsSnippet}`;

    const endpoint = `https://${LOCATION()}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID()}/locations/${LOCATION()}/publishers/google/models/veo-3.1-generate-001:predictLongRunning`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{
          prompt: videoPrompt,
          image: { bytesBase64Encoded: coverBase64, mimeType: 'image/png' },
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
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Veo 3 API ${res.status}: ${body.substring(0, 200)}`);
    }

    let operation = await res.json();
    const operationName = operation.name;
    console.log(`[VideographerAgent] Long-running op started: ${operationName}`);

    const opsEndpoint = `https://${LOCATION()}-aiplatform.googleapis.com/v1/${operationName}`;
    const maxWaitMs = 5 * 60 * 1000;
    const startTime = Date.now();

    while (!operation.done) {
      if (Date.now() - startTime > maxWaitMs) {
        console.warn('[VideographerAgent] Veo 3 timed out after 5 minutes.');
        return '';
      }
      await new Promise((r) => setTimeout(r, 15000));

      const pollRes = await fetch(opsEndpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      operation = await pollRes.json();
    }

    if (operation.error) {
      throw new Error(`Veo 3 operation error: ${JSON.stringify(operation.error)}`);
    }

    const videoBase64 =
      operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.bytesBase64Encoded;

    if (videoBase64) {
      const buffer = Buffer.from(videoBase64, 'base64');
      const fileName = `videos/${chatId}_${Date.now()}.mp4`;
      const url = await uploadToGCS(buffer, fileName, 'video/mp4');
      console.log(`[VideographerAgent] Video uploaded (${(buffer.length / 1024 / 1024).toFixed(1)} MB).`);
      return url;
    }

    console.warn('[VideographerAgent] Veo 3 returned no video data.');
    return '';
  } catch (err) {
    console.error('[VideographerAgent] Veo 3 error:', err.message);
    return '';
  }
}

module.exports = { run, description: AGENT_DESCRIPTION };

/**
 * Gemini Live API — Vertex AI WebSocket with ADC Bearer auth.
 *
 * Model is passed as a URL query param (publishers/google/models/...) so that
 * project/location stay in ADC only — no duplication in the model path.
 *
 * Protocol:
 *   1. Fetch OAuth2 access token via GoogleAuth (ADC)
 *   2. Open WebSocket to Vertex AI BidiGenerateContent with Bearer token header
 *   3. Send { setup: { model, config } } as first message
 *   4. Stream audio chunks as { realtimeInput: { mediaChunks: [...] } }
 *   5. Receive { serverContent: { modelTurn: { parts: [...] } } } back
 */
const WebSocket = require('ws');
const { updateSession, getSession } = require('./db');
const { runGenerationPipeline } = require('./ai_pipeline');

// AI Studio v1alpha — required for native audio preview models
const MODEL = 'models/gemini-2.5-flash-native-audio-preview-09-2025';
const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

const ECHO_SYSTEM_PROMPT = `You are Echo, a warm and enthusiastic AI music assistant that transforms learning content into personalized music tracks.

Your conversation goal is to collect three things from the user:
1. Their LEARNING GOAL today (e.g., "understanding machine learning", "learning about DeFi")
2. Their preferred MUSIC GENRE (e.g., "Lo-fi Hip Hop", "Synthwave", "Jazz", "Pop")
3. At least one URL — links to articles, YouTube videos, or tweets they've been reading

Follow this STRICT conversation flow — do NOT skip steps or call trigger_generation() early:
- STEP 1: Warmly greet the user and ask what they want to learn today. Wait for their answer.
- STEP 2: Once they give a goal, ask what music genre fits their mood. Wait for their answer.
- STEP 3: Once they give a genre, ask them to share at least one URL. Wait for their answer.
- STEP 4: Read back all three collected items (goal, genre, URL(s)) and explicitly ask "Ready to generate your track?"
- STEP 5: ONLY call trigger_generation() after the user confirms "yes" in Step 4.

CRITICAL RULES:
- NEVER call trigger_generation() unless you have ALL THREE: a real goal, a real genre, AND at least one real URL.
- NEVER assume, invent, or use default values for goal, genre, or links.
- If any of the three is missing, ask for it before proceeding.
- Do NOT call trigger_generation() after a simple greeting or if the user hasn't provided all three items.

Keep responses SHORT (2-3 sentences). Be enthusiastic about music and learning.`;

const TRIGGER_GENERATION_DECLARATION = {
  name: 'trigger_generation',
  description: 'Call when the user has provided goal, genre, and at least one URL and wants to generate their track.',
  parameters: {
    type: 'OBJECT',
    properties: {
      goal: { type: 'STRING', description: "The user's learning goal" },
      genre: { type: 'STRING', description: 'Music genre preference' },
      links: { type: 'ARRAY', items: { type: 'STRING' }, description: 'URLs provided by the user' },
      scalePreference: { type: 'STRING', description: 'Optional musical scale (e.g. "A Minor", "C Major", "minor", "major")' },
      density: { type: 'NUMBER', description: 'Optional music density 0.0 (sparse) to 1.0 (full)' },
      brightness: { type: 'NUMBER', description: 'Optional music brightness 0.0 (dark) to 1.0 (bright)' },
    },
    required: ['goal', 'genre', 'links'],
  },
};


/**
 * @param {import('ws').WebSocket} ws  Browser WebSocket connection
 * @param {string} chatId
 * @param {string} baseUrl
 */
async function handleLiveSession(ws, chatId, baseUrl) {
  let geminiWs = null;
  let generationTriggered = false;

  function sendToClient(obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ── Connect to AI Studio v1alpha ──────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    sendToClient({ type: 'error', message: 'GEMINI_API_KEY not set.' });
    ws.close();
    return;
  }

  geminiWs = new WebSocket(`${GEMINI_LIVE_URL}?key=${apiKey}`);

  geminiWs.on('open', () => {
    console.log(`[Live] Gemini WebSocket opened for chat ${chatId}`);

    const setup = {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
          },
        },
        systemInstruction: {
          parts: [{ text: ECHO_SYSTEM_PROMPT }],
        },
        tools: [{ functionDeclarations: [TRIGGER_GENERATION_DECLARATION] }],
      },
    };

    console.log('[Live] Sending setup:', JSON.stringify(setup, null, 2));
    geminiWs.send(JSON.stringify(setup));
  });

  geminiWs.on('message', async (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());

      // Setup complete confirmation
      if (msg.setupComplete !== undefined) {
        console.log(`[Live] Setup complete for chat ${chatId}`);
        sendToClient({ type: 'ready' });
        // Nudge Echo to greet the user
        geminiWs.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            turnComplete: true,
          },
        }));
        return;
      }

      const serverContent = msg.serverContent;
      const parts = serverContent?.modelTurn?.parts || [];

      // 1. Audio chunks → forward to browser
      for (const part of parts) {
        if (part.inlineData?.data) {
          sendToClient({ type: 'audio', data: part.inlineData.data });
        }
      }

      // 2. Text transcript
      const transcript =
        parts.find((p) => p.text)?.text ||
        serverContent?.outputTranscription?.text;
      if (transcript) sendToClient({ type: 'ai_text', text: transcript });

      // 3. Tool call
      const nestedFnCall = parts.find((p) => p.functionCall)?.functionCall;
      const rawCalls =
        msg.toolCall?.functionCalls ||
        (nestedFnCall ? [nestedFnCall] : null);
      if (rawCalls) {
        for (const call of rawCalls) {
          if (call.name === 'trigger_generation') {
            handleTriggerGeneration(call.args, call.id);
          }
        }
      }

      // 4. Turn complete
      if (serverContent?.turnComplete) sendToClient({ type: 'turn_complete' });

    } catch (err) {
      console.error('[Live] Error parsing Vertex AI message:', err.message);
    }
  });

  geminiWs.on('error', (err) => {
    console.error(`[Live] Vertex AI WS error for chat ${chatId}:`, err.message);
    sendToClient({ type: 'error', message: `Vertex AI connection error: ${err.message}` });
  });

  geminiWs.on('close', (code, reason) => {
    console.log(`[Live] Vertex AI WS closed for chat ${chatId} — code: ${code}, reason: ${reason?.toString()}`);
    sendToClient({ type: 'closed' });
  });

  // ── Handle messages from browser ───────────────────────────────────────────
  ws.on('message', async (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN) return;

      if (msg.type === 'audio') {
        geminiWs.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ data: msg.data, mimeType: 'audio/pcm;rate=16000' }],
          },
        }));
      } else if (msg.type === 'text') {
        geminiWs.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: msg.data }] }],
            turnComplete: true,
          },
        }));
      } else if (msg.type === 'trigger_manual') {
        // Browser "Generate with Settings" or "Straight Echoing!" button
        handleManualTrigger(msg);
      } else if (msg.type === 'image') {
        geminiWs.send(JSON.stringify({
          clientContent: {
            turns: [{
              role: 'user',
              parts: [
                { text: 'I am sharing this image as source material for my music track.' },
                { inlineData: { data: msg.data, mimeType: msg.mimeType || 'image/jpeg' } },
              ],
            }],
            turnComplete: true,
          },
        }));
      }
    } catch (err) {
      console.error('[Live] Browser message error:', err.message);
    }
  });

  ws.on('close', () => {
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
  });

  ws.on('error', (err) => {
    console.error('[Live] Browser WS error:', err.message);
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
  });

  // ── Manual trigger from browser buttons ───────────────────────────────────
  async function handleManualTrigger(msg) {
    if (generationTriggered) return;

    // Read session to validate collected data
    let session;
    try {
      session = await getSession(chatId);
    } catch (err) {
      console.error('[Live] handleManualTrigger: failed to read session', err);
      sendToClient({ type: 'error', message: 'Failed to read session. Please try again.' });
      return;
    }

    const { goal, genre, links } = session || {};
    if (!goal || !goal.trim()) {
      sendToClient({ type: 'error', message: 'Please share your learning goal via voice or text first.' });
      return;
    }
    if (!genre || !genre.trim()) {
      sendToClient({ type: 'error', message: 'Please share your music genre preference first.' });
      return;
    }
    if (!Array.isArray(links) || links.length === 0) {
      sendToClient({ type: 'error', message: 'Please share at least one URL first.' });
      return;
    }

    generationTriggered = true;

    const musicSettings = {};
    if (!msg.useDefaults) {
      if (msg.scalePreference) musicSettings.scalePreference = msg.scalePreference;
      if (typeof msg.density === 'number') musicSettings.density = msg.density;
      if (typeof msg.brightness === 'number') musicSettings.brightness = msg.brightness;
    }

    console.log(`[Live] Manual trigger for chat ${chatId}:`, { goal, genre, linksCount: links.length, musicSettings });

    try {
      await updateSession(chatId, {
        status: 'processing',
        generation_results: {
          lyrics: '', image_url: '', audio_url: '', video_url: '',
          musical_dna: { bpm: '', mood: '', key: '' }, image_prompt: '',
        },
      });

      sendToClient({ type: 'generation_started', digestUrl: `/digest/${chatId}`, chatId });
      runGenerationPipeline(chatId, null, musicSettings).catch(console.error);
    } catch (err) {
      console.error('[Live] handleManualTrigger error:', err);
      generationTriggered = false;
      sendToClient({ type: 'error', message: 'Failed to start generation.' });
    }
  }

  // ── Tool: trigger generation ───────────────────────────────────────────────
  async function handleTriggerGeneration(args, callId) {
    if (generationTriggered) return;
    generationTriggered = true;

    const { goal, genre, links, scalePreference, density, brightness } = args;
    const musicSettings = {};
    if (scalePreference) musicSettings.scalePreference = scalePreference;
    if (typeof density === 'number') musicSettings.density = density;
    if (typeof brightness === 'number') musicSettings.brightness = brightness;

    // Guard: require all three fields to be genuinely provided
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      console.warn(`[Live] trigger_generation called without goal — ignoring`);
      generationTriggered = false; // allow retry
      sendToClient({ type: 'error', message: 'Missing goal. Please tell Echo what you want to learn.' });
      return;
    }
    if (!genre || typeof genre !== 'string' || !genre.trim()) {
      console.warn(`[Live] trigger_generation called without genre — ignoring`);
      generationTriggered = false;
      sendToClient({ type: 'error', message: 'Missing genre. Please tell Echo what music genre you prefer.' });
      return;
    }
    if (!Array.isArray(links) || links.length === 0) {
      console.warn(`[Live] trigger_generation called without links — ignoring`);
      generationTriggered = false;
      sendToClient({ type: 'error', message: 'Missing links. Please share at least one URL.' });
      return;
    }

    console.log(`[Live] Triggering generation for chat ${chatId}:`, { goal, genre, linksCount: links.length });

    try {
      await updateSession(chatId, {
        goal, genre, links, status: 'processing',
        username: `voice_user_${chatId.substring(0, 6)}`,
        generation_results: {
          lyrics: '', image_url: '', audio_url: '', video_url: '',
          musical_dna: { bpm: '', mood: '', key: '' }, image_prompt: '',
        },
      });

      // Send tool response back to Gemini
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(JSON.stringify({
          toolResponse: {
            functionResponses: [{
              id: callId,
              name: 'trigger_generation',
              response: { success: true, message: 'Track generation started!' },
            }],
          },
        }));
      }

      sendToClient({ type: 'generation_started', digestUrl: `/digest/${chatId}`, chatId });
      runGenerationPipeline(chatId, null, musicSettings).catch(console.error);
    } catch (err) {
      console.error('[Live] handleTriggerGeneration error:', err);
      sendToClient({ type: 'error', message: 'Failed to start generation.' });
    }
  }
}

module.exports = { handleLiveSession };

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
const { updateSession } = require('./db');
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

Follow this natural conversation flow:
- Start by warmly greeting the user and asking what they want to learn today
- Once you have their goal, ask what music genre fits their mood
- Once you have genre, ask them to share any links they've been reading
- Confirm what you've collected and ask if they're ready to generate their track
- When they say yes, call trigger_generation() with the collected data

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

  // ── Tool: trigger generation ───────────────────────────────────────────────
  async function handleTriggerGeneration(args, callId) {
    if (generationTriggered) return;
    generationTriggered = true;

    const { goal = 'Learning and growing', genre = 'Lo-fi Hip Hop', links = [] } = args;
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

      sendToClient({ type: 'generation_started', digestUrl: `${baseUrl}/digest/${chatId}`, chatId });
      runGenerationPipeline(chatId, null).catch(console.error);
    } catch (err) {
      console.error('[Live] handleTriggerGeneration error:', err);
      sendToClient({ type: 'error', message: 'Failed to start generation.' });
    }
  }
}

module.exports = { handleLiveSession };

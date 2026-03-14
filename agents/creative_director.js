/**
 * CreativeDirectorAgent — ADK-style agent using Gemini 2.5 Pro.
 * Generates song lyrics, album art direction, musical DNA, and production notes.
 */
const { GoogleGenAI } = require('@google/genai');

const AGENT_DESCRIPTION =
  'Generates song lyrics, visual art direction, and musical metadata using Gemini 2.5 Pro';

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * @param {{ goal, genre, contentAnalysis: { summary, keyThemes, keyInsights, emotionalTone } }} params
 * @returns {Promise<{ lyrics, image_prompt, musical_dna, music_direction, track_title }>}
 */
async function run({ goal, genre, contentAnalysis }) {
  console.log('[CreativeDirectorAgent] Generating creative direction with Gemini 2.5 Pro...');

  const { summary = '', keyThemes = [], keyInsights = [], emotionalTone = 'inspired' } =
    contentAnalysis || {};

  const prompt = `You are a master songwriter, music producer, and creative director.

**Learning Goal:** ${goal}
**Music Genre:** ${genre}
**Content Summary:** ${summary}
**Key Themes:** ${keyThemes.join(', ')}
**Key Insights:** ${keyInsights.join('; ')}
**Emotional Tone:** ${emotionalTone}

**Your Mission:**
1. Write exactly 16 lines of original song lyrics that transform these learning insights into an emotionally resonant ${genre} track. Make them poetic, genre-authentic, and meaningful.
2. Create a vivid album cover image prompt for Imagen 4 — pure visual art, NO text or words rendered in the image.
3. Define the Musical DNA metadata.
4. Write concise music production direction for Lyria 3.

**Respond ONLY with this exact JSON (no markdown fences):**
{
  "lyrics": "Line 1\\nLine 2\\n...16 lines total...",
  "image_prompt": "Detailed artistic visual description for album cover, no text, ${genre} aesthetic...",
  "musical_dna": {
    "bpm": "90",
    "mood": "Focused",
    "key": "C Minor"
  },
  "music_direction": "Production notes: e.g. warm synth pads, crisp hi-hats, breathy vocals, 90 BPM, reverb-heavy, ${genre} production style",
  "track_title": "Short catchy song title (3-5 words)"
}`;

  try {
    // Try Gemini 2.5 Pro first for superior creative quality
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt,
    });

    let text = response.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    return JSON.parse(text);
  } catch (proErr) {
    console.warn('[CreativeDirectorAgent] Gemini 2.5 Pro unavailable, falling back to Flash:', proErr.message);

    try {
      const response = await gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      let text = response.text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      return JSON.parse(text);
    } catch (err) {
      console.error('[CreativeDirectorAgent] Both models failed:', err.message);
      return getFallback(goal, genre);
    }
  }
}

function getFallback(goal, genre) {
  return {
    lyrics: `Walking through the wisdom of today
Every word a stepping stone along the way
${goal}—the fire that lights my path
Learning through the music, learning through the craft

Verse by verse, I build what I know
Beat by beat, I let the knowledge flow
${genre} vibes to carry me through
Every insight fresh and new

This is my anthem, this is my sound
In the pages of knowledge, I have found
A melody for everything I've learned
Wisdom earned, wisdom earned

The journey never ends, but the beat goes on
Every question asked, every answer won`,
    image_prompt: `Abstract digital art representing knowledge and music, ${genre} aesthetic, flowing geometric shapes, vibrant neon colors on dark background, cinematic lighting`,
    musical_dna: { bpm: '95', mood: 'Inspired', key: 'D Major' },
    music_direction: `${genre} production with clear melodic hooks, warm bass, and lyrical focus`,
    track_title: 'Knowledge Flow',
  };
}

module.exports = { run, description: AGENT_DESCRIPTION };

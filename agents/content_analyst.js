/**
 * ContentAnalystAgent — ADK-style agent that scrapes and analyzes source content.
 * Extracts key themes, insights, and emotional tone to inform creative direction.
 */
const { GoogleGenAI } = require('@google/genai');
const { scrapeContent } = require('../scraper');

const AGENT_DESCRIPTION =
  'Scrapes URLs and extracts key educational themes and insights for music creation';

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * @param {{ links: string[], goal: string }} params
 * @returns {Promise<{ summary, keyThemes, keyInsights, emotionalTone, rawContent }>}
 */
async function run({ links, goal }) {
  console.log(`[ContentAnalystAgent] Analyzing ${links.length} source(s)...`);

  const rawContent = await scrapeContent(links);
  if (!rawContent || rawContent.trim().length === 0) {
    return {
      summary: `Content related to: ${goal}`,
      keyThemes: [goal],
      keyInsights: [`Learning about ${goal}`],
      emotionalTone: 'educational',
      rawContent: '',
    };
  }

  const prompt = `You are a content analyst. Analyze this content for someone whose goal is: "${goal}".

Content (may be truncated):
${rawContent.substring(0, 8000)}

Respond ONLY with this exact JSON (no markdown fences):
{
  "summary": "2-3 sentence overview of the main ideas",
  "keyThemes": ["theme1", "theme2", "theme3"],
  "keyInsights": ["insight1", "insight2", "insight3"],
  "emotionalTone": "single adjective e.g. inspiring",
  "targetAudience": "who this content is for"
}`;

  try {
    const response = await gemini.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    let text = response.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const analysis = JSON.parse(text);
    return { ...analysis, rawContent };
  } catch (err) {
    console.error('[ContentAnalystAgent] Analysis failed:', err.message);
    return {
      summary: `Content related to: ${goal}`,
      keyThemes: [goal],
      keyInsights: [`Exploring ${goal}`],
      emotionalTone: 'educational',
      targetAudience: 'curious learners',
      rawContent,
    };
  }
}

module.exports = { run, description: AGENT_DESCRIPTION };

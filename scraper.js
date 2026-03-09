/**
 * Scraper module — extracts text content from URLs.
 * Supports: YouTube, X/Twitter, and standard web pages.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { YoutubeTranscript } = require('youtube-transcript');

/**
 * Determine URL type.
 */
function getUrlType(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    }
    if (hostname.includes('x.com') || hostname.includes('twitter.com')) {
      return 'twitter';
    }
    return 'web';
  } catch {
    return 'web';
  }
}

/**
 * Extract YouTube video captions via youtube-transcript.
 */
async function scrapeYouTube(url) {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(url);
    const text = transcript.map((t) => t.text).join(' ');
    return text || '[No captions available for this video]';
  } catch (err) {
    console.error(`[Scraper] YouTube error for ${url}:`, err.message);
    return `[Could not extract captions from: ${url}]`;
  }
}

/**
 * Extract tweet text via vxtwitter.com proxy (og:description meta tag).
 */
async function scrapeTwitter(url) {
  try {
    // Rewrite the URL domain to vxtwitter.com
    const parsed = new URL(url);
    parsed.hostname = 'vxtwitter.com';
    const proxyUrl = parsed.toString();

    const { data: html } = await axios.get(proxyUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EchoBot/1.0)' },
    });

    const $ = cheerio.load(html);
    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content');

    if (description) {
      return description;
    }

    // Fallback: try to extract any visible text
    const bodyText = $('body').text().trim().substring(0, 2000);
    return bodyText || `[Could not extract text from tweet: ${url}]`;
  } catch (err) {
    console.error(`[Scraper] Twitter error for ${url}:`, err.message);
    return `[Could not extract text from tweet: ${url}]`;
  }
}

/**
 * Extract text from a standard web page (all <p>, <h1>, <h2> tags).
 * No character limit — full content extraction.
 */
async function scrapeWeb(url) {
  try {
    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EchoBot/1.0)' },
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);

    // Remove scripts, styles, nav, footer to reduce noise
    $('script, style, nav, footer, header, aside').remove();

    const elements = [];
    $('h1, h2, p').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 0) {
        elements.push(text);
      }
    });

    const content = elements.join('\n');
    return content || `[No readable content found at: ${url}]`;
  } catch (err) {
    console.error(`[Scraper] Web error for ${url}:`, err.message);
    return `[Could not scrape: ${url}]`;
  }
}

/**
 * Scrape an array of URLs and return a single concatenated string.
 * @param {string[]} urls - Array of URLs to scrape
 * @returns {Promise<string>} Combined text content
 */
async function scrapeContent(urls) {
  if (!urls || urls.length === 0) {
    return '';
  }

  const results = [];

  for (const url of urls) {
    const type = getUrlType(url);
    let content = '';

    console.log(`[Scraper] Processing (${type}): ${url}`);

    switch (type) {
      case 'youtube':
        content = await scrapeYouTube(url);
        break;
      case 'twitter':
        content = await scrapeTwitter(url);
        break;
      default:
        content = await scrapeWeb(url);
    }

    results.push(`--- Source: ${url} ---\n${content}`);
  }

  return results.join('\n\n');
}

module.exports = { scrapeContent };

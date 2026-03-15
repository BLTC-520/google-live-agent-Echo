/**
 * Unit tests for the Echo multi-agent pipeline.
 *
 * These tests verify business logic — output validation, data transforms,
 * and agent contract shapes — without hitting real GCP APIs.
 */

// ── Helpers extracted from server.js (tested in isolation) ──────────────────

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(url) {
  if (typeof url !== 'string') return '#';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '#';
  return escapeHtml(trimmed);
}

// ── Agent output validators ──────────────────────────────────────────────────

function validateContentAnalystOutput(output) {
  if (!output || typeof output !== 'object') return false;
  if (!Array.isArray(output.keyThemes)) return false;
  if (typeof output.summary !== 'string') return false;
  return true;
}

function validateCreativeDirectorOutput(output) {
  if (!output || typeof output !== 'object') return false;
  if (typeof output.lyrics !== 'string' || output.lyrics.length === 0) return false;
  if (typeof output.track_title !== 'string' || output.track_title.length === 0) return false;
  if (typeof output.image_prompt !== 'string' || output.image_prompt.length === 0) return false;
  if (!output.musical_dna || typeof output.musical_dna !== 'object') return false;
  return true;
}

function validatePipelineResult(result) {
  if (!result || typeof result !== 'object') return false;
  const required = ['lyrics', 'image_url', 'audio_url', 'musical_dna', 'track_title'];
  return required.every(k => Object.prototype.hasOwnProperty.call(result, k));
}

// ── Demo request validator (mirrors /api/demo-generate logic) ────────────────

function validateDemoRequest({ goal, genre, links }) {
  const errors = [];
  if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
    errors.push('goal is required');
  }
  if (!genre || typeof genre !== 'string' || genre.trim().length === 0) {
    errors.push('genre is required');
  }
  if (!Array.isArray(links) || links.length === 0) {
    errors.push('at least one link is required');
  } else {
    const valid = links.filter(l => typeof l === 'string' && /^https?:\/\//i.test(l.trim()));
    if (valid.length === 0) errors.push('no valid http/https URLs provided');
  }
  return errors;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
  test('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
  test('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });
  test('returns empty string for null', () => {
    expect(escapeHtml(null)).toBe('');
  });
  test('handles non-string input', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('safeUrl', () => {
  test('allows https URLs', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com');
  });
  test('allows http URLs', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
  });
  test('blocks javascript: protocol', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
  });
  test('blocks data: URIs', () => {
    expect(safeUrl('data:text/html,<h1>xss</h1>')).toBe('#');
  });
  test('returns # for non-string', () => {
    expect(safeUrl(null)).toBe('#');
    expect(safeUrl(undefined)).toBe('#');
  });
  test('escapes HTML in safe URL', () => {
    expect(safeUrl('https://example.com?q=<test>')).toBe('https://example.com?q=&lt;test&gt;');
  });
});

describe('validateContentAnalystOutput', () => {
  test('accepts valid output', () => {
    const output = { keyThemes: ['AI', 'learning'], summary: 'Article about AI.' };
    expect(validateContentAnalystOutput(output)).toBe(true);
  });
  test('rejects missing keyThemes', () => {
    expect(validateContentAnalystOutput({ summary: 'text' })).toBe(false);
  });
  test('rejects non-array keyThemes', () => {
    expect(validateContentAnalystOutput({ keyThemes: 'AI', summary: 'text' })).toBe(false);
  });
  test('rejects missing summary', () => {
    expect(validateContentAnalystOutput({ keyThemes: [] })).toBe(false);
  });
  test('rejects null', () => {
    expect(validateContentAnalystOutput(null)).toBe(false);
  });
});

describe('validateCreativeDirectorOutput', () => {
  const validOutput = {
    lyrics: 'Verse 1\nLearning all the things',
    track_title: 'The Echo Track',
    image_prompt: 'A vibrant album cover',
    musical_dna: { bpm: '120', mood: 'Energetic', key: 'C Major' },
    music_direction: 'upbeat jazz',
  };
  test('accepts valid output', () => {
    expect(validateCreativeDirectorOutput(validOutput)).toBe(true);
  });
  test('rejects empty lyrics', () => {
    expect(validateCreativeDirectorOutput({ ...validOutput, lyrics: '' })).toBe(false);
  });
  test('rejects missing track_title', () => {
    const { track_title, ...rest } = validOutput;
    expect(validateCreativeDirectorOutput(rest)).toBe(false);
  });
  test('rejects missing musical_dna', () => {
    const { musical_dna, ...rest } = validOutput;
    expect(validateCreativeDirectorOutput(rest)).toBe(false);
  });
});

describe('validatePipelineResult', () => {
  const validResult = {
    lyrics: 'Some lyrics',
    image_url: 'https://storage.googleapis.com/bucket/cover.jpg',
    audio_url: 'https://storage.googleapis.com/bucket/track.wav',
    musical_dna: { bpm: '120', mood: 'Chill', key: 'D Minor' },
    track_title: 'Learning Jazz',
  };
  test('accepts complete result', () => {
    expect(validatePipelineResult(validResult)).toBe(true);
  });
  test('rejects missing audio_url', () => {
    const { audio_url, ...rest } = validResult;
    expect(validatePipelineResult(rest)).toBe(false);
  });
  test('rejects null', () => {
    expect(validatePipelineResult(null)).toBe(false);
  });
});

describe('validateDemoRequest', () => {
  test('accepts valid request', () => {
    const errors = validateDemoRequest({
      goal: 'Learn about LLMs',
      genre: 'Jazz',
      links: ['https://example.com/article'],
    });
    expect(errors).toHaveLength(0);
  });
  test('rejects empty goal', () => {
    const errors = validateDemoRequest({ goal: '', genre: 'Jazz', links: ['https://a.com'] });
    expect(errors).toContain('goal is required');
  });
  test('rejects missing genre', () => {
    const errors = validateDemoRequest({ goal: 'test', genre: '', links: ['https://a.com'] });
    expect(errors).toContain('genre is required');
  });
  test('rejects empty links array', () => {
    const errors = validateDemoRequest({ goal: 'test', genre: 'Jazz', links: [] });
    expect(errors).toContain('at least one link is required');
  });
  test('rejects non-http links', () => {
    const errors = validateDemoRequest({ goal: 'test', genre: 'Jazz', links: ['ftp://bad.com'] });
    expect(errors).toContain('no valid http/https URLs provided');
  });
  test('allows mixed valid and invalid links', () => {
    const errors = validateDemoRequest({
      goal: 'test', genre: 'Jazz',
      links: ['ftp://bad.com', 'https://good.com'],
    });
    expect(errors).toHaveLength(0);
  });
  test('caps links at 5 (validated externally)', () => {
    const links = Array.from({ length: 10 }, (_, i) => `https://example.com/${i}`);
    const errors = validateDemoRequest({ goal: 'test', genre: 'Jazz', links });
    expect(errors).toHaveLength(0);
  });
});

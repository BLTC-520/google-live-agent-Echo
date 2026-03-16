/**
 * Firestore database helper module.
 * Collection: "sessions" — document ID = Telegram chat_id
 */
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const db = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
});

const COLLECTION = 'sessions';

/**
 * Default session shape for new users.
 */
const DEFAULT_SESSION = {
  goal: '',
  genre: '',
  links: [],
  status: 'idle',
  username: '',
  createdAt: '',
  generation_results: {
    lyrics: '',
    image_url: '',
    audio_url: '',
    video_url: '',
    musical_dna: { bpm: '', mood: '', key: '' },
    image_prompt: '',
  },
};

/**
 * Get an existing session or create a new one.
 * @param {string} chatId - Telegram chat ID
 * @returns {Promise<Object>} Session data
 */
async function getSession(chatId) {
  const docRef = db.collection(COLLECTION).doc(String(chatId));
  const doc = await docRef.get();

  if (doc.exists) {
    return { id: doc.id, ...doc.data() };
  }

  // Create new session with defaults
  const newSession = { ...DEFAULT_SESSION, createdAt: new Date().toISOString() };
  await docRef.set(newSession);
  return { id: String(chatId), ...newSession };
}

/**
 * Partial-update a session document.
 * @param {string} chatId - Telegram chat ID
 * @param {Object} data - Fields to merge
 */
async function updateSession(chatId, data) {
  const docRef = db.collection(COLLECTION).doc(String(chatId));
  await docRef.set(data, { merge: true });
}

/**
 * Append a link to the session's links array (idempotent via arrayUnion).
 * @param {string} chatId - Telegram chat ID
 * @param {string} link - URL to append
 */
async function appendLink(chatId, link) {
  const docRef = db.collection(COLLECTION).doc(String(chatId));
  await docRef.set(
    { links: FieldValue.arrayUnion(link) },
    { merge: true }
  );
}

/**
 * List all completed sessions, newest first.
 * @param {number} limit - Max sessions to return
 * @returns {Promise<Object[]>} Array of session data
 */
async function listSessions(limit = 50) {
  const snapshot = await db.collection(COLLECTION)
    .where('status', '==', 'completed')
    .limit(limit)
    .get();

  const sessions = [];
  snapshot.forEach(doc => sessions.push({ id: doc.id, ...doc.data() }));

  return sessions.sort((a, b) => {
    const aTime = a.createdAt || a.id;
    const bTime = b.createdAt || b.id;
    return bTime > aTime ? 1 : -1;
  });
}

module.exports = { getSession, updateSession, appendLink, listSessions };

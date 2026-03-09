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
  generation_results: {
    lyrics: '',
    image_url: '',
    audio_url: '',
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
  await docRef.set(DEFAULT_SESSION);
  return { id: String(chatId), ...DEFAULT_SESSION };
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

module.exports = { getSession, updateSession, appendLink };

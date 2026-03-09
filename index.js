/**
 * Entry point — initializes environment, Firestore, bot, and Express server.
 */
require('dotenv').config();

const { app } = require('./server');

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`🎧 Echo server is live on port ${PORT}`);
  console.log(`   Landing page: http://localhost:${PORT}`);
  console.log(`   Webhook:      POST http://localhost:${PORT}/webhook`);
  console.log(`   Digest:       GET  http://localhost:${PORT}/digest/:chat_id`);
});

/**
 * Entry point — HTTP server + WebSocket server for Gemini Live sessions.
 */
require('dotenv').config();

const http = require('http');
const WebSocket = require('ws');
const { app } = require('./server');
const { handleLiveSession } = require('./live-session');

const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.CLOUD_RUN_URL || `http://localhost:${PORT}`;

// Create HTTP server wrapping Express
const server = http.createServer(app);

// WebSocket server for Gemini Live sessions (path: /live-ws)
const wss = new WebSocket.Server({ server, path: '/live-ws' });

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get('chatId') || String(Date.now());
    console.log(`[WS] New live session connected: chat ${chatId}`);
    handleLiveSession(ws, chatId, BASE_URL);
  } catch (err) {
    console.error('[WS] Connection error:', err.message);
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`🎧 Echo server is live on port ${PORT}`);
  console.log(`   Landing page:  http://localhost:${PORT}`);
  console.log(`   Live session:  http://localhost:${PORT}/live`);
  console.log(`   Webhook:       POST http://localhost:${PORT}/webhook`);
  console.log(`   Digest:        GET  http://localhost:${PORT}/digest/:chat_id`);
  console.log(`   WebSocket:     ws://localhost:${PORT}/live-ws?chatId=<id>`);
});

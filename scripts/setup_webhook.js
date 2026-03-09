/**
 * One-time script to register the Telegram webhook.
 * Usage: TELEGRAM_BOT_TOKEN=xxx CLOUD_RUN_URL=https://... node scripts/setup_webhook.js
 */
require('dotenv').config();
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CLOUD_RUN_URL = process.env.CLOUD_RUN_URL;

if (!TOKEN || !CLOUD_RUN_URL) {
  console.error('❌ Missing TELEGRAM_BOT_TOKEN or CLOUD_RUN_URL env vars.');
  process.exit(1);
}

const webhookUrl = `${CLOUD_RUN_URL}/webhook`;

async function setWebhook() {
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${TOKEN}/setWebhook`,
      { url: webhookUrl }
    );
    if (res.data.ok) {
      console.log(`✅ Webhook set successfully: ${webhookUrl}`);
    } else {
      console.error('❌ Telegram API error:', res.data.description);
    }
  } catch (err) {
    console.error('❌ Request failed:', err.message);
  }
}

setWebhook();

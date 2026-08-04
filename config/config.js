// ============================================
// FILE: config/config.js
// ============================================
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  whapi: {
    token: process.env.WHAPI_TOKEN,
    channel: process.env.WHAPI_CHANNEL || 'default',
    baseUrl: 'https://gate.whapi.cloud',
  },
  mongodb: {
    url: process.env.MONGODB_URL || 'mongodb://localhost:27017/whatsapp_service',
  },
  backend: {
    apiUrl: process.env.BACKEND_API_URL,
    apiKey: process.env.BACKEND_API_KEY,
  },
  webhook: {
    secret: process.env.WEBHOOK_SECRET, // Optional: for webhook validation
  },

  whatsappProvider: process.env.WHATSAPP_PROVIDER || 'whapi', // 'whapi' | 'meta'

    whapi: {
    baseUrl: process.env.WHAPI_BASE_URL,
    token: process.env.WHAPI_TOKEN,
    channel: process.env.WHAPI_CHANNEL,
  },

  meta: {
    baseUrl: process.env.META_BASE_URL || 'https://graph.facebook.com/v20.0',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID,
    accessToken: process.env.META_ACCESS_TOKEN,
    appSecret: process.env.META_APP_SECRET,
    verifyToken: process.env.META_VERIFY_TOKEN,
  },
};
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const config = require('../../config/config');
const Logger = require('../../utils/logger');

const httpsAgent = new https.Agent({ family: 4, keepAlive: true, maxSockets: 50, timeout: 30000 });

class MetaProvider {
  constructor() {
    this.baseUrl = config.meta.baseUrl;
    this.phoneNumberId = config.meta.phoneNumberId;
    this.accessToken = config.meta.accessToken;
    this.appSecret = config.meta.appSecret;
    this.verifyToken = config.meta.verifyToken;
  }

  parseIncoming(body) {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages || [];
    return messages.map(m => this._normalize(m));
  }

  _normalize(m) {
    return {
      id: m.id,
      from: m.from,
      type: m.type,
      text: m.text,
      audio: m.audio,
      voice: m.voice,
      image: m.image,
      document: m.document,
      interactive: m.interactive
        ? { button_reply: m.interactive.button_reply, list_reply: m.interactive.list_reply }
        : undefined,
      raw: m,
    };
  }

  // GET /webhook handshake — only Meta needs this
  verifyWebhookRequest(req) {
    return (
      req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === this.verifyToken
    );
  }

  verifySignature(req) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature || !req.rawBody) return false;
    const expected = crypto.createHmac('sha256', this.appSecret).update(req.rawBody).digest('hex');
    return signature === `sha256=${expected}`;
  }

  async sendMessage(to, text) {
    const response = await axios.post(
      `${this.baseUrl}/${this.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' }, httpsAgent }
    );
    return response.data;
  }

//   async sendInteractiveMessage({ to, type = 'button', header, body, footer, action }) {
//     const response = await axios.post(
//       `${this.baseUrl}/${this.phoneNumberId}/messages`,
//       { messaging_product: 'whatsapp', to, type: 'interactive', interactive: { type, header, body, footer, action } },
//       { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' }, httpsAgent }
//     );
//     return response.data;
//   }

async sendInteractiveMessage({ to, type = 'button', header, body, footer, action }) {
  const transformedAction = this._transformActionForMeta(type, action);

  const response = await axios.post(
    `${this.baseUrl}/${this.phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: { type, header, body, footer, action: transformedAction },
    },
    { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' }, httpsAgent }
  );
  return response.data;
}

// Meta requires buttons/rows nested under `reply`, not flat title/id.
_transformActionForMeta(type, action) {
  if (!action) return action; 

  if (type === 'button' && Array.isArray(action.buttons)) {
    return {
      ...action,
      buttons: action.buttons.map(btn => ({
        type: 'reply',
        reply: { id: btn.id, title: btn.title },
      })),
    };
  }

  if (type === 'list' && Array.isArray(action.sections)) {
    return {
      ...action,
      sections: action.sections.map(section => ({
        ...section,
        rows: (section.rows || []).map(row => ({
          id: row.id,
          title: row.title,
          description: row.description,
        })),
      })),
    };
  }

  return action;
}

  async sendMediaMessage(to, type, mediaUrl, captions) {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type,
      [type]: { link: mediaUrl, caption: captions ?? undefined },
    };
    const response = await axios.post(`${this.baseUrl}/${this.phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      httpsAgent,
    });
    return response.data;
  }

  async sendTyping({ messageId }) {
    if (!messageId) return;
    try {
      await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } },
        { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' }, httpsAgent }
      );
    } catch (error) {
      Logger.warn('sendTyping failed', { error: error.message });
    }
  }

  async downloadMedia(message) {
    const mediaId = message.audio?.id || message.voice?.id;
    if (!mediaId) return null;

    const metaResp = await axios.get(`${this.baseUrl}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    const mediaUrl = metaResp.data.url;

    const mediaResp = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      responseType: 'arraybuffer',
    });
    return Buffer.from(mediaResp.data);
  }

  async getChannelInfo() {
    const response = await axios.get(`${this.baseUrl}/${this.phoneNumberId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      httpsAgent,
    });
    return response.data;
  }
}

module.exports = new MetaProvider();
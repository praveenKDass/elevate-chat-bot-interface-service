const axios = require('axios');
const https = require('https');
const config = require('../../config/config');
const Logger = require('../../utils/logger');

const httpsAgent = new https.Agent({ family: 4, keepAlive: true, maxSockets: 50, timeout: 30000 });

class WhapiProvider {
  constructor() {
    this.baseUrl = config.whapi.baseUrl;
    this.token = config.whapi.token;
    this.channel = config.whapi.channel;
  }

  // Whapi → common normalized shape
  parseIncoming(body) {
    const messages = body.messages || [];
    return messages
      .filter(m => !m.from_me && !this._isGroupOrBroadcast(m))
      .map(m => this._normalize(m));
  }

  _isGroupOrBroadcast(m) {
    return (
      m.chat?.id?.includes('@g.us') ||
      m.chat?.id?.includes('@broadcast') ||
      m.chat?.id?.includes('@newsletter')
    );
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
      interactive: this._normalizeInteractive(m),
      raw: m,
    };
  }

  _normalizeInteractive(m) {
    const buttonsReply = m.interactive?.buttons_reply || m.reply?.buttons_reply || m.buttons_reply;
    const listReply = m.interactive?.list_reply || m.reply?.list_reply || m.list_reply;
    if (!buttonsReply && !listReply) return undefined;
    return {
      button_reply: buttonsReply ? { id: buttonsReply.id, title: buttonsReply.title } : undefined,
      list_reply: listReply ? { id: listReply.id, title: listReply.title } : undefined,
    };
  }

  // No hub.challenge handshake for Whapi — always pass
  verifyWebhookRequest() {
    return true;
  }

  // Whapi doesn't sign payloads by default — no-op unless you add a shared secret header check
  verifySignature() {
    return true;
  }

  async sendMessage(to, text) {
    const response = await axios.post(
      `${this.baseUrl}/messages/text`,
      { to, body: text },
      { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, params: { channel: this.channel }, httpsAgent }
    );
    return response.data;
  }

  async sendInteractiveMessage({ to, type = 'button', header, body, footer, action }) {
    const response = await axios.post(
      `${this.baseUrl}/messages/interactive`,
      { to: `${to}`, type, header, body, footer, action },
      { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, httpsAgent }
    );
    return response.data;
  }

  async sendMediaMessage(to, type, mediaUrl, captions) {
    const endpointMap = { image: 'image', video: 'video', document: 'document', audio: 'audio' };
    const endPoint = endpointMap[type];
    if (!endPoint) throw new Error(`Unsupported message type: ${type}`);

    const payload = { to: `${to}`, type, media: mediaUrl, caption: captions ?? '' };
    if (type === 'document') payload.filename = 'Document';

    const response = await axios.post(`${this.baseUrl}/messages/${endPoint}`, payload, {
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      httpsAgent,
    });
    return response.data;
  }

  // Whapi keys typing off phoneNumber; Meta needs messageId — caller passes both, each provider uses what it needs
  async sendTyping({ phoneNumber }) {
    try {
      await axios.put(
        `${this.baseUrl}/presences/${phoneNumber}`,
        { presence: 'typing', delay: 0 },
        { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, timeout: 5000 }
      );
    } catch (error) {
      Logger.warn('sendTyping failed', { error: error.message });
    }
  }

  async downloadMedia(message) {
    const mediaId = message.audio?.id || message.voice?.id;
    if (!mediaId) return null;
    const response = await axios.get(`${this.baseUrl}/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      timeout: 15000,
    });
    return Buffer.from(response.data);
  }

  async getChannelInfo() {
    const response = await axios.get(`${this.baseUrl}/channels`, {
      headers: { Authorization: `Bearer ${this.token}` },
      httpsAgent,
    });
    return response.data;
  }
}

module.exports = new WhapiProvider();
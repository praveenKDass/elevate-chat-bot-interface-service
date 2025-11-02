const axios = require("axios");
const config = require("../config/config");
const Logger = require("../utils/logger");

class WhatsAppService {
  constructor() {
    this.baseUrl = config.whapi.baseUrl;
    this.token = config.whapi.token;
    this.channel = config.whapi.channel;
  }

  /**
   * Send text message via WhatsApp
   * @param {string} to - Recipient phone number
   * @param {string} text - Message text
   * @returns {Promise<Object>}
   */
  async sendMessage(to, text) {
    try {
      Logger.info("Sending WhatsApp message", { to, textLength: text.length });

      const response = await axios.post(
        `${this.baseUrl}/messages/text`,
        {
          to: to,
          body: text,
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          params: {
            channel: this.channel,
          },
        }
      );

      Logger.info("Message sent successfully", { messageId: response.data.id });
      return response.data;
    } catch (error) {
      Logger.error("Failed to send WhatsApp message", error);
      throw new Error(
        `WhatsApp send failed: ${error.response?.data?.error || error.message}`
      );
    }
  }

  /**
   * Send welcome message to new user
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   */
  async sendWelcomeMessage(phoneNumber, name) {
    const message = `Welcome ${name}! 👋\n\nYour account has been created successfully. How can I help you today?`;
    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Send acknowledgment message to existing user
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @param {string} messageText - Original message from user
   */
  async sendAcknowledgment(phoneNumber, name, messageText) {
    const message = `Hi ${name}! I received your message: "${messageText}"\n\nHow can I assist you?`;
    return this.sendMessage(phoneNumber, message);
  }

  /**
   * Get channel information
   * @returns {Promise<Object>}
   */
  async getChannelInfo() {
    try {
      const response = await axios.get(`${this.baseUrl}/channels`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });
      return response.data;
    } catch (error) {
      Logger.error("Failed to get channel info", error);
      throw error;
    }
  }

  /**
   * Send interactive (button) message via WhatsApp
   * @param {string} to - Recipient phone number
   * @param {Object} interactivePayload - Interactive message content
   * @returns {Promise<Object>}
   */
  async sendInteractiveMessage({
    to,
    type = "button",
    header,
    body,
    footer,
    action,
  }) {
    try {
      const payload = {
        to: `${to}`,
        type, // 'button' | 'list' | 'product'
        header,
        body,
        footer,
        action,
      };

      Logger.info("Sending interactive message", payload);

      const response = await axios.post(
        "https://gate.whapi.cloud/messages/interactive",
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.WHAPI_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response.data;
    } catch (error) {
      Logger.error("Failed to send interactive message", {
        message: error.message,
        stack: error.stack,
        data: error.response?.data,
      });
      throw new Error(`Interactive message failed: ${error.message}`);
    }
  }

  async sendMediaMessage(to, type, mediaUrl,captions ) {
    try {
        console.log(to, type, mediaUrl,captions,"testing")
      const payload = {
        to: `${to}`,
        type,
        media:mediaUrl,
        caption:captions ?? "",
        
      };

      if(type === "document") {
        payload.filename = "Document"
      }

      Logger.info("Sending media message", payload);
      const endpointMap = {
        image: "image",
        video: "video",
        document: "document",
        audio: "audio", // optional future support
      };

      const endPoint = endpointMap[type];

      if (!endPoint) {
        throw new Error(`Unsupported message type: ${type}`);
      }
      const response = await axios.post(
        `https://gate.whapi.cloud/messages/${endPoint}`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.WHAPI_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response.data;
    } catch (error) {
      Logger.error("Failed to send media message", {
        message: error.message,
        stack: error.stack,
        data: error.response?.data,
      });
      throw new Error(`Media message failed: ${error.message}`);
    }
  }
}

module.exports = new WhatsAppService();

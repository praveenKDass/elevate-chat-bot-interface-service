// ============================================
// FILE: controllers/webhookController.js
// ============================================
const whatsappService = require("../services/whatsappService");
const userService = require("../services/userService");
const Logger = require("../utils/logger");

// Store processed message IDs to prevent duplicates
const processedMessages = new Set();

class WebhookController {
  /**
   * Handle incoming WhatsApp webhook
   */
  async handleWebhook(req, res) {
    try {
      // Acknowledge receipt immediately
      res.status(200).json({ status: "received" });

      const { messages } = req.body;

      if (!messages || messages.length === 0) {
        Logger.debug("No messages in webhook payload");
        return;
      }

      // Process each message asynchronously
      for (const message of messages) {
        WebhookController.processMessage(message).catch((error) => {
          Logger.error("Error processing message", error);
        });
      }
    } catch (error) {
      Logger.error("Error in webhook handler", error);
      // Don't send error response as we already sent 200
    }
  }

  /**
   * Process individual message
   * @private
   */
  static async processMessage(message) {
    try {
      // Skip if already processed
      if (processedMessages.has(message.id)) {
        Logger.debug("Message already processed", { messageId: message.id });
        return;
      }

      processedMessages.add(message.id);

      // Clean up old message IDs (keep last 1000)
      if (processedMessages.size > 1000) {
        const firstId = processedMessages.values().next().value;
        processedMessages.delete(firstId);
      }

      Logger.info("Processing incoming message1", message);

      // Skip outgoing messages
      if (message.from_me) {
        Logger.debug("Skipping outgoing message", { messageId: message.id });
        return;
      }

      // Extract message details
      const phoneNumber = message.from;
      const messageText = message.text?.body || "";
      const senderName = message.from_name || "User";

      Logger.info("Processing incoming message", {
        from: phoneNumber,
        name: senderName,
        text: messageText.substring(0, 50),
      });
      // Check if user exists
      const userExists = await userService.checkUserExists(phoneNumber);

      //   if (!userExists.success) {
      //     if (
      //       message.type === "reply" &&
      //       message.reply.buttons_reply.id.includes("YES_LOGIN")
      //     ) {
      //       // Create new user
      //       await userService.createUser(phoneNumber, senderName, {
      //         firstMessage: messageText,
      //         firstMessageAt: new Date().toISOString(),
      //       });

      //       // Send welcome message
      //       await whatsappService.sendWelcomeMessage(phoneNumber, senderName);

      //       Logger.info("New user onboarded", { phoneNumber, name: senderName });
      //     } else {
      //       let userLoginRes = await whatsappService.sendInteractiveMessage({
      //         to: phoneNumber,
      //         type: "button",
      //         body: {
      //           text:
      //             message.type === "reply" &&
      //             message.reply.buttons_reply.id.includes("NO_LOGIN")
      //               ? ` 👋 Hi ${senderName}. Please Login to explore more  :`
      //               : `Welcome to Shikshalokam! 👋 I'm here to help you with your questions ${senderName}. Please proceed to Login :`,
      //         },
      //         action: {
      //           buttons: [
      //             { type: "quick_reply", title: "Yes", id: "YES_LOGIN" },
      //             { type: "quick_reply", title: "NO", id: "NO_LOGIN" },
      //           ],
      //         },
      //       });

      //       console.log(userLoginRes);
      //     }
      //   } else {
      //     // User exists, send acknowledgment
      //     await whatsappService.sendAcknowledgment(
      //       phoneNumber,
      //       senderName,
      //       messageText
      //     );

      //     Logger.info("Existing user message handled", { phoneNumber });
      //   }
      const type = message.type; // e.g., "video" or "image"
      const mediaData = message[type]; // dynamically access message.video or message.image

      if (mediaData?.link) {
        const mediaUrl = mediaData.link;

        const result = await whatsappService.sendMediaMessage(
          phoneNumber,
          type,
          mediaUrl,
          `Verifying chat with ${type}`
        );
        console.log(result,"this is result")
      }
    } catch (error) {
      Logger.error("Failed to process message", error);
      throw error;
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck(req, res) {
    try {
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "whatsapp-webhook",
        uptime: process.uptime(),
      });
    } catch (error) {
      res.status(500).json({ status: "error", message: error.message });
    }
  }

  /**
   * Test endpoint to verify Whapi connection
   */
  async testConnection(req, res) {
    try {
      const channelInfo = await whatsappService.getChannelInfo();
      res.json({
        status: "connected",
        channels: channelInfo,
      });
    } catch (error) {
      Logger.error("Connection test failed", error);
      res.status(500).json({
        status: "failed",
        error: error.message,
      });
    }
  }
}

module.exports = new WebhookController();

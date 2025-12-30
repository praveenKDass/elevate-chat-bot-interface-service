// // ============================================
// // FILE: controllers/webhookController.js
// // ============================================
// const whatsappService = require("../services/whatsappService");
// const Logger = require("../utils/logger");
// const flowRouter = require("../services/flowRouter"); // NEW
// const userQueries = require("../database/databaseQueries/userQueries");
// // Store processed message IDs to prevent duplicates
// const processedMessages = new Set();

// class WebhookController {
//   /**
//    * Handle incoming WhatsApp webhook
//    */
//   async handleWebhook(req, res) {
//     try {
//       // Acknowledge receipt immediately
//       res.status(200).json({ status: "received" });

//       const { messages } = req.body;

//       if (!messages || messages.length === 0) {
//         Logger.debug("No messages in webhook payload");
//         return;
//       }

//       // Process each message asynchronously
//       for (const message of messages) {
//         WebhookController.processMessage(message).catch((error) => {
//           Logger.error("Error processing message", error);
//         });
//       }
//     } catch (error) {
//       Logger.error("Error in webhook handler", error);
//       // Don't send error response as we already sent 200
//     }
//   }

//   /**
//    * Process individual message
//    * @private
//    */
//   static async processMessage(message) {
//     try {
//       // Skip if already processed
//       if (processedMessages.has(message.id)) {
//         Logger.debug("Message already processed", { messageId: message.id });
//         return;
//       }

//       processedMessages.add(message.id);

//       // Clean up old message IDs (keep last 1000)
//       if (processedMessages.size > 1000) {
//         const firstId = processedMessages.values().next().value;
//         processedMessages.delete(firstId);
//       }

//       Logger.info("Processing incoming message", {
//         messageId: message.id,
//         from: message.from,
//         type: message.type,
//       });

//       // Skip outgoing messages
//       if (
//         message.from_me ||
//         message.chat?.id?.includes("@g.us") || // WhatsApp group
//         message.chat?.id?.includes("@broadcast") || // Broadcast list
//         message.chat?.id?.includes("@newsletter")
//       ) {
//         Logger.debug("Skipping outgoing message", { messageId: message.id });
//         return;
//       }

//       // ============================================
//       // 🎯 MAIN ROUTING LOGIC - Let flowRouter handles the flow
//       // ============================================
//       const result = await flowRouter.route(message);

//       if (result.success) {
//         Logger.info("Message handled successfully", {
//           messageId: message.id,
//           handled: result.handled,
//           flow: result.flow || "none",
//         });
//       } else {
//         Logger.warn("Message handling failed", {
//           messageId: message.id,
//           error: result.error,
//         });

//         // Send fallback message
//         // await whatsappService.sendMessage(
//         //   message.from,
//         //   "❌ Sorry, something went wrong. Please try again or type 'help'."
//         // );
//       }
//       // await userQueries.clearLastMessage(message.from);
//     } catch (error) {
//       Logger.error("Failed to process message", error);

//       // Send error message to user
//       // try {
//       //   await whatsappService.sendMessage(
//       //     message.from,
//       //     "❌ An unexpected error occurred. Please try again later."
//       //   );
//       //   // await userQueries.clearLastMessage(message.from);

//       // } catch (sendError) {
//       //   Logger.error("Failed to send error message", sendError);
//       // }
//     }
//   }

//   /**
//    * Health check endpoint
//    */
//   async healthCheck(req, res) {
//     try {
//       res.json({
//         status: "ok",
//         timestamp: new Date().toISOString(),
//         service: "whatsapp-webhook",
//         uptime: process.uptime(),
//       });
//     } catch (error) {
//       res.status(500).json({ status: "error", message: error.message });
//     }
//   }

//   /**
//    * Test endpoint to verify Whapi connection
//    */
//   async testConnection(req, res) {
//     try {
//       const channelInfo = await whatsappService.getChannelInfo();
//       res.json({
//         status: "connected",
//         channels: channelInfo,
//       });
//     } catch (error) {
//       Logger.error("Connection test failed", error);
//       res.status(500).json({
//         status: "failed",
//         error: error.message,
//       });
//     }
//   }
// }

// module.exports = new WebhookController();

// ============================================
// FILE: controllers/webhookController.js - UPDATED FOR MCP
// ============================================
const whatsappService = require("../services/whatsappService");
const Logger = require("../utils/logger");
const flowRouter = require("../services/flowRouter");
const messageController = require("./messageController");
const userQueries = require("../database/databaseQueries/userQueries");

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
   * Routes to either FlowRouter (interactive) or MessageController (AI/NLP)
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

      const phoneNumber = message.from;

      Logger.info("Processing incoming message", {
        messageId: message.id,
        from: phoneNumber,
        type: message.type,
      });

      // Skip outgoing messages and group messages
      if (
        message.from_me ||
        message.chat?.id?.includes("@g.us") ||
        message.chat?.id?.includes("@broadcast") ||
        message.chat?.id?.includes("@newsletter")
      ) {
        Logger.debug("Skipping outgoing/group message", { messageId: message.id });
        return;
      }

      // ============================================
      // STEP 1: Route through MessageController
      // This smart controller decides the path
      // ============================================
      const result = await messageController.handleWhatsAppMessage(
        message,
        phoneNumber
      );

      if (result.success) {
        Logger.info("Message handled successfully", {
          messageId: message.id,
          handled: result.handled,
          route: result.route || "default",
        });
      } else {
        Logger.warn("Message handling failed", {
          messageId: message.id,
          error: result.error,
        });
      }
    } catch (error) {
      Logger.error("Failed to process message", error);
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
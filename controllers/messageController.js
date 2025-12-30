// ============================================
// FILE: controllers/messageController.js - SIMPLE & CORRECT
// ============================================
const Logger = require("../utils/logger");
const flowRouter = require("../services/flowRouter");
const aiService = require("../services/aiService");
const whatsappService = require("../services/whatsappService");
const usersQueries = require("../database/databaseQueries/userQueries");
const Project = require("../database/models/project");
const axios = require("axios");

class MessageController {
  /**
   * Main entry point for all WhatsApp messages
   * Routes: Interactive → FlowRouter | Simple Command → FlowRouter | Natural Language → Claude
   */
  static async handleWhatsAppMessage(message, phoneNumber) {
    try {
      Logger.info("MessageController: Received message", {
        phoneNumber,
        type: message.type,
      });

      // ============================================
      // STEP 1: Interactive Messages (Buttons/Lists)
      // ============================================
      if (this.isInteractiveMessage(message)) {
        Logger.info("MessageController: Interactive → FlowRouter", {
          phoneNumber,
        });
        const result = await flowRouter.route(message);
        return { ...result, route: "flowrouter-interactive" };
      }

      // ============================================
      // STEP 2: Voice/Audio Messages
      // ============================================
      if (message.type === "audio" || message.type === "voice") {
        Logger.info("MessageController: Audio → Transcribe → NLP", {
          phoneNumber,
        });
        return await this.handleAudioMessage(message, phoneNumber);
      }

      // ============================================
      // STEP 3: Text Messages
      // ============================================
      if (message.type === "text") {
        const messageText = message.text?.body?.trim() || "";

        Logger.info("MessageController: Text message", {
          phoneNumber,
          text: messageText.substring(0, 50),
        });

        // Simple commands go to FlowRouter
        if (this.isSimpleCommand(messageText)) {
          Logger.info("MessageController: Simple command → FlowRouter", {
            phoneNumber,
          });
          const result = await flowRouter.route(message);
          return { ...result, route: "flowrouter-command" };
        }

        // Natural language goes to Claude
        Logger.info("MessageController: Natural language → Claude", {
          phoneNumber,
        });
        return await this.handleNaturalLanguage(
          message,
          phoneNumber,
          messageText
        );
      }

      // ============================================
      // STEP 4: Media (Images, Documents)
      // ============================================
      if (message.type === "image" || message.type === "document") {
        Logger.info("MessageController: Media → FlowRouter", {
          phoneNumber,
          type: message.type,
        });
        const result = await flowRouter.route(message);
        return { ...result, route: "flowrouter-media" };
      }

      // Fallback
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Sorry, I can only handle text, voice, images, and interactive messages."
      );
      return { success: false, handled: true, route: "unsupported" };
    } catch (error) {
      Logger.error("MessageController: Fatal error", error);
      return {
        success: false,
        handled: false,
        error: error.message,
        route: "error",
      };
    }
  }

  /**
   * Check if message is interactive (buttons/lists)
   */
  static isInteractiveMessage(message) {
    return !!(
      message?.interactive?.buttons_reply?.id ||
      message?.reply?.buttons_reply?.id ||
      message?.buttons_reply?.id ||
      message?.interactive?.list_reply?.id ||
      message?.reply?.list_reply?.id ||
      message?.list_reply?.id
    );
  }

  /**
   * Check if text is a simple command (no AI needed)
   */
  static isSimpleCommand(text) {
    const simpleCommands =
      /^(projects|help|menu|cancel|exit|stop|quit|done|finish|complete|next|mainmenu|hi)$/i;
    return simpleCommands.test(text);
  }

  /**
   * Handle Audio/Voice Message
   * Download → Transcribe → Process as Natural Language
   */
  static async handleAudioMessage(message, phoneNumber) {
    try {
      Logger.info("MessageController: Processing audio message", {
        phoneNumber,
      });

      // Acknowledge to user
      await whatsappService.sendMessage(
        phoneNumber,
        "🎤 Processing your voice message..."
      );

      // Download audio from WhatsApp
      const audioBuffer = await this.downloadWhatsAppAudio(message);

      if (!audioBuffer) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Failed to download voice message. Please try again or type your message."
        );
        return { success: false, handled: true, route: "audio-failed" };
      }

      // Transcribe using OpenAI Whisper
      const transcription = await aiService.transcribeVoice(
        audioBuffer,
        "audio/ogg"
      );

      if (!transcription.success || !transcription.text) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Could not understand your voice message. Please try again or type your message."
        );
        return { success: false, handled: true, route: "transcription-failed" };
      }

      const transcribedText = transcription.text.trim();

      Logger.info("MessageController: Voice transcribed", {
        phoneNumber,
        text: transcribedText.substring(0, 100),
      });

      // Show transcription to user
      await whatsappService.sendMessage(
        phoneNumber,
        `📝 *You said:*\n"${transcribedText}"\n\n⏳ Processing...`
      );

      // Process transcribed text as natural language
      return await this.handleNaturalLanguage(
        message,
        phoneNumber,
        transcribedText
      );
    } catch (error) {
      Logger.error("MessageController: Error processing audio", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error processing voice message. Please try typing instead."
      );
      return { success: false, handled: true, route: "audio-error" };
    }
  }

  /**
   * Handle Natural Language Text
   * Call Claude → Claude analyzes intent → Claude calls MCP → MCP calls Bot API → Service executes
   */
  static async handleNaturalLanguage(message, phoneNumber, messageText) {
    try {
      Logger.info("MessageController: Processing natural language", {
        phoneNumber,
        text: messageText.substring(0, 50),
      });

      // ============================================
      // Step 1: Build user context for Claude
      // ============================================
      const userContext = await this.buildUserContext(phoneNumber);

      Logger.info("MessageController: User context built", {
        phoneNumber,
        projectCount: userContext.projectCount,
      });

      // ============================================
      // Step 2: Call Claude to analyze intent
      // Claude will:
      // - Analyze the user's intent
      // - Call MCP tool if needed
      // - MCP will call your bot /mcp/* endpoints
      // - Service will execute and send WhatsApp message
      // - Response comes back through MCP to Claude
      // ============================================
      const intent = await aiService.analyzeUserIntent(
        messageText,
        userContext,
        [] // conversation history (empty for now)
      );

      Logger.info("MessageController: Intent analyzed", {
        phoneNumber,
        intent: intent.intent,
        confidence: intent.confidence,
        entities: intent.entities,
      });

      // ============================================
      // Step 3: Handle low confidence
      // ============================================
      if (intent.needsClarification || intent.confidence < 0.6) {
        const clarificationMsg =
          intent.clarificationQuestion ||
          "🤔 I'm not sure I understood. Could you be more specific?\n\nType 'help' for options.";

        Logger.info("MessageController: Low confidence, asking for clarification", {
          phoneNumber,
          confidence: intent.confidence,
        });

        // await whatsappService.sendMessage(phoneNumber, clarificationMsg);
        return { success: true, handled: true, route: "nlp-clarification" };
      }

      // ============================================
      // Step 4: Done!
      // Claude already:
      // ✅ Analyzed intent
      // ✅ Called MCP tool
      // ✅ MCP called bot API
      // ✅ Service executed and sent WhatsApp message
      // ✅ Response returned to Claude
      //
      // We just need to acknowledge and return
      // ============================================
      Logger.info("MessageController: Intent executed successfully", {
        phoneNumber,
        intent: intent.intent,
      });

      return {
        success: true,
        handled: true,
        route: "nlp-success",
        intent: intent.intent,
      };
    } catch (error) {
      Logger.error("MessageController: NLP error", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "I encountered an error. Type 'menu' for options."
      );
      return { success: false, handled: true, route: "nlp-error" };
    }
  }

  /**
   * Build context for Claude understanding
   */
  static async buildUserContext(phoneNumber) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const user = await usersQueries.findUserByPhone(phoneNumber);

      const userProjects = await Project.find(
        { phoneNumber },
        { projectId: 1, projectName: 1, tasks: 1, submissionStatus: 1 }
      ).lean();

      return {
        phoneNumber,
        userName: user?.name,
        currentFlow: lastMessage?.flow,
        currentStep: lastMessage?.step,
        currentContext: lastMessage?.context,
        projects: userProjects,
        projectCount: userProjects.length,
        taskCounts: userProjects.map((p) => ({
          projectName: p.projectName,
          taskCount: p.tasks?.length || 0,
        })),
      };
    } catch (error) {
      Logger.error("MessageController: Error building context", error);
      return { phoneNumber };
    }
  }

  /**
   * Download audio from WhatsApp
   */
  static async downloadWhatsAppAudio(message) {
    try {
      const audioId = message.audio?.id || message.voice?.id;

      if (!audioId) {
        Logger.error("No audio ID found in message", {
          messageType: message.type,
          hasAudio: !!message.audio,
          hasVoice: !!message.voice,
        });
        return null;
      }

      Logger.info("Downloading WhatsApp audio", { audioId });

      const config = require("../config/config");

      // Get media URL from Whapi
      const mediaInfoResponse = await axios.get(
        `${config.whapi.baseUrl}/media/${audioId}`,
        {
          headers: {
            Authorization: `Bearer ${config.whapi.token}`,
          },
          timeout: 15000,
        }
      );

      // const mediaUrl =
      //   mediaInfoResponse.data.url ||
      //   mediaInfoResponse.data.link ||
      //   mediaInfoResponse.data.media?.url;

      // if (!mediaUrl) {
      //   Logger.error("No media URL in response", {
      //     response: mediaInfoResponse.data,
      //   });
      //   return null;
      // }

      // Logger.info("Media URL obtained", { url: mediaUrl.substring(0, 50) });

      // // Download audio
      // const audioResponse = await axios.get(mediaUrl, {
      //   responseType: "arraybuffer",
      //   headers: {
      //     Authorization: `Bearer ${config.whapi.token}`,
      //   },
      //   timeout: 30000,
      // });

      const buffer = Buffer.from(mediaInfoResponse.data);

      Logger.info("Audio downloaded successfully", {
        size: buffer.length,
      });

      return buffer;
    } catch (error) {
      Logger.error("Error downloading WhatsApp audio", error);
      return null;
    }
  }
}

module.exports = MessageController;
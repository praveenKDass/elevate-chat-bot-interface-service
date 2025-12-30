// ============================================
// FILE: services/flowRouter.js - WITH EVIDENCE UPLOAD
// ============================================
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const inactivityReminderService = require("./inactivityReminderService");
const userService = require("./userService");
const projectService = require("./projectService");
const registrationFlow = require("./registrationFlow");
const taskService = require("./taskService");
const storyService = require("./storyService");
const programService = require("./programService");
const projectSubmissionService = require("./projectSubmissionService");
const Project = require("../database/models/project");
const fileUploadService = require("./fileUploadService");
const aiService = require("./aiService2");
const aiIntentRouter = require("./aiIntentRouter");
class FlowRouter {
  constructor() {
    this.flowHandlers = {
      registration: registrationFlow,
      project_creation: projectService,
      project_update: projectService,
      project_tasks: taskService,
      improvement_project: taskService,
      analytics: programService,
      story_recording: storyService,
    };
  }

  /**
   * Main routing logic - decides which service should handle the message
   * @param {Object} message - WhatsApp message object
   * @returns {Promise<{success: boolean, handled: boolean}>}
   */
  async route(message) {
    try {
      const phoneNumber = message.from;

      // ============================================
      // STEP 0: Track user activity
      // ============================================
      await inactivityReminderService.trackUserActivity(phoneNumber);

      // ============================================
      // STEP 0.5: Handle media files (EVIDENCE UPLOAD)
      // ============================================
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      console.log(lastMessage, "this is lastMessage");

      if (
        lastMessage?.context?.uploadingEvidence &&
        this.isMediaMessage(message)
      ) {
        return await this.handleMediaUpload(message, phoneNumber);
      }

      const messageText = message.text?.body?.trim() || "";

      Logger.info("Flow routing check", {
        phoneNumber,
        hasActiveFlow: !!lastMessage?.flow,
        currentFlow: lastMessage?.flow || "none",
        currentStep: lastMessage?.step || 0,
        messageType: message.type,
      });

      // ============================================
      // STEP 2.5:  Handle Voice Messages (AI Transcription)
      // ============================================
      if (message.type === "audio" || message.type === "voice") {
        return await this.handleVoiceMessage(message, phoneNumber);
      }

      // ============================================
      // STEP 2.6: Handle Natural Language with AI (before button clicks)
      // ============================================
      // if (messageText && !selectedAction) {
      //   // Skip AI for simple commands
      //   const skipAI =
      //     /^(projects|help|menu|cancel|exit|stop|quit|done|finish|complete|next)$/i;

      //   if (!skipAI.test(messageText)) {
      //     Logger.info("Attempting AI processing", {
      //       phoneNumber,
      //       text: messageText.substring(0, 30),
      //     });

      //     const aiResult = await this.handleNaturalLanguageInput(
      //       message,
      //       phoneNumber,
      //       messageText
      //     );

      //     if (aiResult.handled) {
      //       return aiResult;
      //     }
      //   }
      // }

      // ============================================
      // STEP 2: Extract interactive responses
      // ============================================
      const buttonResponse =
        message?.interactive?.buttons_reply?.id ||
        message?.reply?.buttons_reply?.id ||
        message?.buttons_reply?.id;

      const listResponse =
        message?.interactive?.list_reply?.id ||
        message?.reply?.list_reply?.id ||
        message?.list_reply?.id;

      let selectedAction = buttonResponse || listResponse;

      if (selectedAction) {
        selectedAction = selectedAction
          .replace(/^ButtonsV3:/, "")
          .replace(/^ListV3:/, "");
      }

      Logger.debug("Extracted actions", {
        buttonResponse,
        listResponse,
        selectedAction,
      });

      // ============================================
      // STEP 3: Route interactive actions
      // ============================================
      if (selectedAction) {
        // Program selection
        if (
          selectedAction.startsWith("program_") &&
          selectedAction !== "main_menu"
        ) {
          const programId = selectedAction.replace("program_", "");
          await programService.handleProgramSelection(
            phoneNumber,
            programId,
            message
          );
          return { success: true, handled: true };
        }

        // Report type selection
        if (selectedAction.startsWith("report_type_")) {
          const reportType = parseInt(
            selectedAction.replace("report_type_", "")
          );
          await programService.handleReportTypeSelection(
            phoneNumber,
            reportType
          );
          return { success: true, handled: true };
        }

        // Program pagination
        if (
          selectedAction.startsWith("next_programs_") ||
          selectedAction.startsWith("prev_programs_")
        ) {
          let page = 1;
          if (selectedAction.startsWith("next_programs_")) {
            page = parseInt(selectedAction.replace("next_programs_", ""));
          } else {
            page = parseInt(selectedAction.replace("prev_programs_", ""));
          }
          await programService.handleProgramPagination(phoneNumber, null, page);
          return { success: true, handled: true };
        }

        // Project pagination
        if (
          selectedAction.startsWith("next_projects_") ||
          selectedAction.startsWith("prev_projects_")
        ) {
          await projectService.handleProjectPagination(
            phoneNumber,
            selectedAction
          );
          return { success: true, handled: true };
        }

        // Start improvement project
        if (selectedAction.startsWith("start_improvement_")) {
          const solutionId = selectedAction.replace("start_improvement_", "");
          const lastMsg = await usersQueries.getLastMessage(phoneNumber);
          const projectData = lastMsg?.context?.project;
          await projectService.handleStartImprovementProject(
            phoneNumber,
            solutionId,
            projectData
          );
          return { success: true, handled: true };
        }

        // View tasks
        if (selectedAction.startsWith("view_tasks_")) {
          const projectId = selectedAction.replace("view_tasks_", "");
          const projectData = await Project.findOne(
            { projectId, phoneNumber },
            { tasks: 1, projectName: 1, projectData: 1 }
          ).lean();

          if (!projectData) {
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Project not found. Please select project again."
            );
            return { success: false, handled: true };
          }
          await taskService.showTasksMenu(phoneNumber, projectData);
          return { success: true, handled: true };
        }

        // Update tasks
        if (selectedAction.startsWith("update_task_")) {
          const projectId = selectedAction.replace("update_task_", "");
          const projectData = await Project.findOne(
            { projectId, phoneNumber },
            { tasks: 1, projectName: 1, projectData: 1 }
          ).lean();

          if (!projectData) {
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Project not found. Please select project again."
            );
            return { success: false, handled: true };
          }
          await taskService.showTaskSummary(phoneNumber, projectData.tasks, 1);
          return { success: true, handled: true };
        }

        // View task resources
        if (selectedAction.startsWith("view_resources_")) {
          const taskIndex = parseInt(
            selectedAction.replace("view_resources_", "")
          );
          await taskService.showTaskResources(phoneNumber, taskIndex);
          return { success: true, handled: true };
        }

        // Update task status menu
        if (selectedAction.startsWith("updated_task_status_")) {
          const taskIndex = parseInt(
            selectedAction.replace("updated_task_status_", "")
          );
          await taskService.showStatusUpdateMenu(phoneNumber, taskIndex);
          return { success: true, handled: true };
        }

        // Set task status
        if (selectedAction.startsWith("set_status_")) {
          const parts = selectedAction.replace("set_status_", "").split("_");
          const taskIndex = parseInt(parts[parts.length - 1]);
          const newStatus = parts.slice(0, -1).join("_");
          await taskService.handleStatusUpdate(
            phoneNumber,
            taskIndex,
            newStatus
          );
          return { success: true, handled: true };
        }

        // Upload evidence
        if (selectedAction.startsWith("upload_evidence_")) {
          const taskIndex = parseInt(
            selectedAction.replace("upload_evidence_", "")
          );
          await taskService.handleEvidenceUploadPrompt(phoneNumber, taskIndex);
          return { success: true, handled: true };
        }

        // Task pagination
        if (
          selectedAction.startsWith("tasks_next_") ||
          selectedAction.startsWith("tasks_prev_")
        ) {
          let page = 1;
          if (selectedAction.startsWith("tasks_next_")) {
            page = parseInt(selectedAction.replace("tasks_next_", ""));
          } else {
            page = parseInt(selectedAction.replace("tasks_prev_", ""));
          }
          await taskService.handleTaskPagination(phoneNumber, null, page);
          return { success: true, handled: true };
        }

        // Project selection
        if (
          selectedAction.includes("solutionWithProject_") ||
          selectedAction.includes("solutionWithoutProject_")
        ) {
          await projectService.showProjectDetails(phoneNumber, message);
          return { success: true, handled: true };
        }

        // Project pagination
        if (
          selectedAction.startsWith("next_page_") ||
          selectedAction.startsWith("prev_page_")
        ) {
          await projectService.handleInteractiveResponse(
            phoneNumber,
            selectedAction
          );
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("view_report_")) {
          const projectId = selectedAction.replace("view_report_", "");
          await projectService.generateProjectReport(phoneNumber, projectId);
          return;
        }

        // Handle View Certificate
        if (selectedAction.startsWith("view_certificate_")) {
          const projectId = selectedAction.replace("view_certificate_", "");
          const lastMessage = await usersQueries.getLastMessage(phoneNumber);
          const project = lastMessage?.context?.project;

          await projectService.showCertificateOptions(phoneNumber, project);
          return;
        }

        // Handle Certificate Format Selection
        if (selectedAction.startsWith("cert_pdf_")) {
          const projectId = selectedAction.replace("cert_pdf_", "");
          await projectService.sendCertificate(phoneNumber, projectId, "pdf");
          return;
        }

        if (selectedAction.startsWith("cert_svg_")) {
          const projectId = selectedAction.replace("cert_svg_", "");
          await projectService.sendCertificate(phoneNumber, projectId, "svg");
          return;
        }

        // ============================================
        // EXACT ACTION MATCHES
        // ============================================
        switch (selectedAction) {
          case "view_analytics":
            await programService.showAnalyticsMenu(phoneNumber);
            return { success: true, handled: true };

          case "view_program_report":
            await programService.listPrograms(phoneNumber, 1);
            return { success: true, handled: true };

          case "start_new_project":
            await usersQueries.updateLastMessage(phoneNumber, {
              flow: "project_creation",
              step: 0,
              context: {},
              text: "start_new_project",
            });
            await projectService.startNewProjectFlow(phoneNumber);
            return { success: true, handled: true };

          case "update_existing_project":
            await inactivityReminderService.resetReminderCount(phoneNumber);
            await projectService.listProjects(phoneNumber, 1);
            return { success: true, handled: true };

          case "record_story":
            await storyService.startStoryRecording(phoneNumber);
            return { success: true, handled: true };

          case "record_another_story":
            await storyService.handleRecordAnotherStory(phoneNumber);
            return { success: true, handled: true };

          case "submit_improvement_project":
            await projectSubmissionService.submitImprovementProject(
              phoneNumber
            );
            return { success: true, handled: true };

          case "view_certificate":
            await projectSubmissionService.handleViewCertificate(phoneNumber);
            return { success: true, handled: true };

          case "share_certificate":
            await projectSubmissionService.handleShareCertificate(phoneNumber);
            return { success: true, handled: true };

          case "dismiss_reminder":
            await inactivityReminderService.handleReminderDismissal(
              phoneNumber
            );
            await whatsappService.sendMessage(
              phoneNumber,
              "✅ Reminder dismissed. Let me know if you need help!"
            );
            await inactivityReminderService.resetReminderCount(phoneNumber);
            return { success: true, handled: true };

          case "check_project_status":
            await inactivityReminderService.resetReminderCount(phoneNumber);
            await projectService.listProjects(phoneNumber, 1);
            return { success: true, handled: true };

          case "back_to_list":
            await projectService.handleBackToList(phoneNumber);
            return { success: true, handled: true };

          case "back_to_tasks":
            const msg = await usersQueries.getLastMessage(phoneNumber);
            const projectId = msg?.context?.projectId;
            const projectData = await Project.findOne(
              { projectId, phoneNumber },
              { tasks: 1, projectName: 1, projectData: 1 }
            ).lean();

            if (!projectData) {
              await whatsappService.sendMessage(
                phoneNumber,
                "❌ Project not found. Please select project again."
              );
              return { success: false, handled: true };
            }
            await taskService.showTaskSummary(
              phoneNumber,
              projectData?.tasks || [],
              1
            );
            return { success: true, handled: true };

          case "back_to_project":
            const lastMsg = await usersQueries.getLastMessage(phoneNumber);
            if (lastMsg?.context?.project) {
              await projectService.showProjectDetails(
                phoneNumber,
                lastMsg.context.project
              );
            } else {
              await projectService.listProjects(phoneNumber, 1);
            }
            return { success: true, handled: true };

          case "main_menu":
            await userService.handleUserMessage(message);
            return { success: true, handled: true };

          default:
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Sorry, I didn't recognize that option. Please try again."
            );
            return { success: true, handled: true };
        }
      }

      // ============================================
      // STEP 4: Handle text input
      // ============================================
      if (messageText) {
        // Handle evidence upload completion
        if (lastMessage?.context?.uploadingEvidence) {
          if (/^(done|finish|complete|next)$/i.test(messageText)) {
            return await this.handleEvidenceUploadComplete(phoneNumber);
          }

          if (/^(cancel|exit)$/i.test(messageText)) {
            await usersQueries.updateLastMessage(phoneNumber, {
              flow: "project_tasks",
              step: 2,
              context: {
                projectId: lastMessage.context.projectId,
                currentTaskIndex: lastMessage.context.currentTaskIndex,
                uploadingEvidence: false,
              },
              text: "cancel_evidence_upload",
            });
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Evidence upload cancelled."
            );
            return { success: true, handled: true };
          }
        }

        // Task number selection
        if (
          lastMessage?.flow === "project_tasks" &&
          /^\d+$/.test(messageText)
        ) {
          const taskIndex = parseInt(messageText);
          const lastMsg = await usersQueries.getLastMessage(phoneNumber);
          const projectId = lastMsg?.context?.projectId;
          const projectData = await Project.findOne(
            { projectId, phoneNumber },
            { tasks: 1, projectName: 1, projectData: 1 }
          ).lean();

          if (!projectData) {
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Project not found. Please select project again."
            );
            return { success: false, handled: true };
          }
          const tasks = projectData.tasks;
          if (taskIndex > 0 && taskIndex <= tasks.length) {
            await taskService.showTaskDetails(phoneNumber, taskIndex);
            return { success: true, handled: true };
          } else {
            await whatsappService.sendMessage(
              phoneNumber,
              `❌ Invalid task number. Please select between 1-${tasks.length}.`
            );
            return { success: true, handled: true };
          }
        }

        // Text commands
        if (/^projects$/i.test(messageText)) {
          await projectService.listProjects(phoneNumber, 1);
          return { success: true, handled: true };
        }

        if (/^help$/i.test(messageText)) {
          await whatsappService.sendMessage(
            phoneNumber,
            "📋 Available commands:\n" +
              "• Type 'projects' to view all projects\n" +
              "• Type 'menu' for main menu\n" +
              "• Type 'cancel' to exit current flow"
          );
          return { success: true, handled: true };
        }

        if (/^menu$/i.test(messageText)) {
          await userService.handleUserMessage(message);
          return { success: true, handled: true };
        }

        if (/^(cancel|exit|stop|quit)$/i.test(messageText)) {
          await usersQueries.clearLastMessage(phoneNumber);
          await whatsappService.sendMessage(
            phoneNumber,
            "❌ Cancelled. Type 'menu' to see options."
          );
          return { success: true, handled: true };
        }

        // Check if in improvement project mode
        if (lastMessage?.flow === "improvement_project") {
          if (/^(submit|done|complete)$/i.test(messageText)) {
            await projectSubmissionService.submitImprovementProject(
              phoneNumber
            );
            return { success: true, handled: true };
          }
        }
      }

      // ============================================
      // STEP 5: User authentication/registration check
      // ============================================
      return await userService.handleUserMessage(message);
    } catch (error) {
      Logger.error("Flow routing error", error);
      await usersQueries.clearLastMessage(message.from);
      return { success: false, handled: false, error: error.message };
    }
  }

  /**
   * Handle media upload for evidence
   */
  async handleMediaUpload(message, phoneNumber) {
    try {
      Logger.info("Processing evidence upload", {
        phoneNumber,
        type: message.type,
      });

      const result = await fileUploadService.handleEvidenceUpload(
        phoneNumber,
        message
      );

      return { success: result.success, handled: true };
    } catch (error) {
      Logger.error("Media upload handling error", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to upload evidence. Please try again later."
      );
      return { success: false, handled: true, error: error.message };
    }
  }

  /**
   * Handle evidence upload completion
   */
  async handleEvidenceUploadComplete(phoneNumber) {
    try {
      const result = await fileUploadService.finishEvidenceUpload(phoneNumber);
      return { success: result.success, handled: true };
    } catch (error) {
      Logger.error("Error completing evidence upload", error);
      return { success: false, handled: true, error: error.message };
    }
  }

  /**
   * Check if message contains media
   */
  isMediaMessage(message) {
    const mediaTypes = ["image", "video", "audio", "document"];
    return mediaTypes.includes(message.type);
  }

  /**
   * Get recent conversation history for context
   */
  async getConversationHistory(phoneNumber, limit = 5) {
    try {
      // You can implement this to store conversation history in MongoDB
      // For now, return empty array
      // TODO: Implement conversation history storage
      return [];
    } catch (error) {
      Logger.error("Error getting conversation history", error);
      return [];
    }
  }

  /**
   * Save message to conversation history
   */
  async saveToConversationHistory(phoneNumber, messageText, intent) {
    try {
      // TODO: Implement conversation history storage in MongoDB
      // Store: phoneNumber, messageText, intent, timestamp
      Logger.debug("Conversation history saved", {
        phoneNumber,
        intent: intent.intent,
      });
    } catch (error) {
      Logger.error("Error saving conversation history", error);
    }
  }

  /**
   * Handle natural language input with AI intent detection
   */
  async handleNaturalLanguageInput(message, phoneNumber, messageText) {
    try {
      Logger.info("Processing natural language", {
        phoneNumber,
        text: messageText.substring(0, 50),
      });

      // Get user context
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const user = await usersQueries.findUserByPhone(phoneNumber);

      // Get user's projects for context
      const userProjects = await Project.find(
        { phoneNumber },
        { projectId: 1, projectName: 1, tasks: 1, submissionStatus: 1 }
      ).lean();

      // Build conversation context
      const conversationContext = {
        currentProject: lastMessage?.context?.projectId
          ? userProjects.find(
              (p) => p.projectId === lastMessage.context.projectId
            )
          : null,
        currentTask: lastMessage?.context?.currentTaskIndex
          ? {
              taskNumber: lastMessage.context.currentTaskIndex,
            }
          : null,
        projects: userProjects,
        userName: user?.name,
        lastFlow: lastMessage?.flow,
      };

      // Get conversation history (last 5 messages)
      const conversationHistory = await this.getConversationHistory(
        phoneNumber
      );

      // Analyze intent with AI
      const intent = await aiService.analyzeUserIntent(
        messageText,
        conversationContext,
        conversationHistory
      );

      Logger.info("AI intent detected", {
        phoneNumber,
        intent: intent.intent,
        confidence: intent.confidence,
        entities: intent.entities,
      });

      // Handle low confidence
      if (intent.needsClarification || intent.confidence < 0.6) {
        await whatsappService.sendMessage(
          phoneNumber,
          intent.clarificationQuestion ||
            "🤔 I'm not sure I understood that. Could you please be more specific?\n\nType 'help' to see what I can do."
        );
        return { success: true, handled: true };
      }

      // Route to AI intent router
      const aiIntentRouter = require("./aiIntentRouter");
      const result = await aiIntentRouter.routeIntent(
        phoneNumber,
        intent,
        conversationContext,
        message
      );

      // Store in conversation history
      await this.saveToConversationHistory(phoneNumber, messageText, intent);

      return result;
    } catch (error) {
      Logger.error("Error processing natural language", error);

      // Fallback to showing menu
      await whatsappService.sendMessage(
        phoneNumber,
        "I encountered an error understanding your request. Type 'menu' to see available options."
      );

      return { success: false, handled: true };
    }
  }

  /**
   * Handle voice message with transcription and AI intent detection
   */
  async handleVoiceMessage(message, phoneNumber) {
    try {
      Logger.info("Processing voice message", {
        phoneNumber,
        messageType: message.type,
        hasAudioId: !!(message.audio?.id || message.voice?.id),
      });

      // Send immediate acknowledgment
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
        return { success: false, handled: true };
      }

      // Transcribe using AI service
      const transcription = await aiService.transcribeVoice(
        audioBuffer,
        "audio/ogg"
      );

      if (!transcription.success || !transcription.text) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Could not understand your voice message. Please try again or type your message."
        );
        return { success: false, handled: true };
      }

      const transcribedText = transcription.text.trim();

      Logger.info("Voice message transcribed", {
        phoneNumber,
        text: transcribedText.substring(0, 100),
        length: transcribedText.length,
      });

      // Show transcription to user for confirmation
      await whatsappService.sendMessage(
        phoneNumber,
        `📝 *You said:*\n"${transcribedText}"\n\n⏳ Processing your request...`
      );

      // Process transcribed text as natural language
      const result = await this.handleNaturalLanguageInput(
        message,
        phoneNumber,
        transcribedText
      );

      return result;
    } catch (error) {
      Logger.error("Error handling voice message", error);

      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error processing voice message. Please try typing your message instead."
      );

      return { success: false, handled: true };
    }
  }

  /**
   * Download audio from WhatsApp via Whapi Cloud
   */
  async downloadWhatsAppAudio(message) {
    try {
      // Get audio/voice ID from message
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

      // Step 1: Get media info/URL from Whapi Cloud
      const mediaInfoResponse = await axios.get(
        `${config.whapi.baseUrl}/media/${audioId}`,
        {
          headers: {
            Authorization: `Bearer ${config.whapi.token}`,
          },
          timeout: 15000,
        }
      );

      const mediaUrl =
        mediaInfoResponse.data.url ||
        mediaInfoResponse.data.link ||
        mediaInfoResponse.data.media?.url;

      if (!mediaUrl) {
        Logger.error("No media URL in response", {
          response: mediaInfoResponse.data,
        });
        return null;
      }

      Logger.info("Media URL obtained", { url: mediaUrl.substring(0, 50) });

      // Step 2: Download actual audio file
      const audioResponse = await axios.get(mediaUrl, {
        responseType: "arraybuffer",
        headers: {
          Authorization: `Bearer ${config.whapi.token}`,
        },
        timeout: 30000,
      });

      const buffer = Buffer.from(audioResponse.data);

      Logger.info("Audio downloaded successfully", {
        size: buffer.length,
        mimeType: audioResponse.headers["content-type"],
      });

      return buffer;
    } catch (error) {
      Logger.error("Error downloading WhatsApp audio", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      return null;
    }
  }
  /**
   * Handle natural language input with AI
   */
  // async handleNaturalLanguageInput(message, phoneNumber, messageText) {
  //   try {
  //     Logger.info("Processing natural language input", {
  //       phoneNumber,
  //       text: messageText.substring(0, 50),
  //     });

  //     // Get user context
  //     const lastMessage = await usersQueries.getLastMessage(phoneNumber);
  //     const user = await usersQueries.findUserByPhone(phoneNumber);

  //     // Get user's projects for context
  //     const userProjects = await Project.find(
  //       { phoneNumber },
  //       { projectId: 1, projectName: 1, tasks: 1 }
  //     ).lean();

  //     const conversationContext = {
  //       currentProject: lastMessage?.context?.projectId
  //         ? userProjects.find(
  //             (p) => p.projectId === lastMessage.context.projectId
  //           )
  //         : null,
  //       projects: userProjects,
  //       userName: user?.name,
  //     };

  //     // Analyze intent with AI
  //     const intent = await aiService.analyzeUserIntent(
  //       messageText,
  //       conversationContext
  //     );

  //     Logger.info("AI intent result", {
  //       intent: intent.intent,
  //       confidence: intent.confidence,
  //     });

  //     // Handle low confidence - ask for clarification
  //     if (intent.needsClarification && intent.clarificationQuestion) {
  //       await whatsappService.sendMessage(
  //         phoneNumber,
  //         `🤔 ${intent.clarificationQuestion}`
  //       );
  //       return { success: true, handled: true };
  //     }

  //     // Route based on intent
  //     return await this.routeByIntent(
  //       phoneNumber,
  //       intent,
  //       conversationContext,
  //       message
  //     );
  //   } catch (error) {
  //     Logger.error("Error handling natural language", error);
  //     return { success: false, handled: false };
  //   }
  // }

  /**
   * Route user to appropriate service based on AI intent
   */
  async routeByIntent(phoneNumber, intent, context, message) {
    try {
      const { intent: intentName, entities, suggestedAction } = intent;

      switch (intentName) {
        case "update_task":
          return await this.handleUpdateTaskIntent(
            phoneNumber,
            entities,
            context
          );

        case "view_tasks":
          return await this.handleViewTasksIntent(
            phoneNumber,
            entities,
            context
          );

        case "view_projects":
          await projectService.listProjects(phoneNumber, 1);
          return { success: true, handled: true };

        case "submit_project":
          await projectSubmissionService.submitImprovementProject(phoneNumber);
          return { success: true, handled: true };

        case "view_report":
          return await this.handleViewReportIntent(
            phoneNumber,
            entities,
            context
          );

        case "view_certificate":
          return await this.handleViewCertificateIntent(
            phoneNumber,
            entities,
            context
          );

        case "ask_help":
          await whatsappService.sendMessage(
            phoneNumber,
            `📋 *How can I help you?*\n\n` +
              `You can say things like:\n` +
              `• "Show my projects"\n` +
              `• "Update task 3"\n` +
              `• "I completed the classroom task"\n` +
              `• "Submit my project"\n` +
              `• "View my certificate"\n\n` +
              `Or type 'menu' for options.`
          );
          return { success: true, handled: true };

        case "general_chat":
          if (suggestedAction) {
            await whatsappService.sendMessage(
              phoneNumber,
              `👋 ${suggestedAction}\n\nType 'menu' to see what you can do.`
            );
          }
          return { success: true, handled: true };

        default:
          // Fallback to menu
          return await userService.handleUserMessage(message);
      }
    } catch (error) {
      Logger.error("Error routing by intent", error);
      return { success: false, handled: false };
    }
  }

  /**
   * Handle update task intent
   */
  async handleUpdateTaskIntent(phoneNumber, entities, context) {
    try {
      let projectId = context.currentProject?.projectId;

      // If no current project, try to find from project name
      if (!projectId && entities.project_name) {
        const matchingProject = context.projects.find((p) =>
          p.projectName
            .toLowerCase()
            .includes(entities.project_name.toLowerCase())
        );
        projectId = matchingProject?.projectId;
      }

      // If still no project and user has only one, use that
      if (!projectId && context.projects.length === 1) {
        projectId = context.projects[0].projectId;
      }

      // If no project identified, ask user to select
      if (!projectId) {
        await whatsappService.sendMessage(
          phoneNumber,
          `📁 Which project would you like to update?\n\nPlease select from your projects:`
        );
        await projectService.listProjects(phoneNumber, 1);
        return { success: true, handled: true };
      }

      // Get project from DB
      const project = await Project.findOne({ projectId, phoneNumber }).lean();

      if (!project) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ Project not found. Please select a project first.`
        );
        await projectService.listProjects(phoneNumber, 1);
        return { success: true, handled: true };
      }

      // Find task by number or name
      let taskIndex = -1;

      if (entities.task_number) {
        taskIndex = entities.task_number - 1;
      } else if (entities.task_name) {
        const matchingTaskIndex = project.tasks.findIndex((t) =>
          (t.taskName || t.name)
            .toLowerCase()
            .includes(entities.task_name.toLowerCase())
        );
        taskIndex = matchingTaskIndex;
      }

      // If task found, handle based on action
      if (taskIndex >= 0 && taskIndex < project.tasks.length) {
        const task = project.tasks[taskIndex];

        // Update context
        await usersQueries.updateLastMessage(phoneNumber, {
          flow: "project_tasks",
          step: 1,
          context: {
            projectId,
            currentTaskIndex: taskIndex + 1,
          },
          text: "ai_update_task",
        });

        // If status mentioned, update directly
        if (entities.status) {
          await taskService.handleStatusUpdate(
            phoneNumber,
            taskIndex + 1,
            entities.status
          );
        } else {
          // Show task details
          await taskService.showTaskDetails(phoneNumber, taskIndex + 1);
        }

        return { success: true, handled: true };
      }

      // Task not found - show task list
      await whatsappService.sendMessage(
        phoneNumber,
        `📋 Here are the tasks for *${project.projectName}*:\n\nSelect a task to update:`
      );
      await taskService.showTaskSummary(phoneNumber, project.tasks, 1);

      return { success: true, handled: true };
    } catch (error) {
      Logger.error("Error handling update task intent", error);
      return { success: false, handled: false };
    }
  }

  /**
   * Handle view tasks intent
   */
  async handleViewTasksIntent(phoneNumber, entities, context) {
    try {
      let projectId = context.currentProject?.projectId;

      if (!projectId && entities.project_name) {
        const matchingProject = context.projects.find((p) =>
          p.projectName
            .toLowerCase()
            .includes(entities.project_name.toLowerCase())
        );
        projectId = matchingProject?.projectId;
      }

      if (!projectId && context.projects.length === 1) {
        projectId = context.projects[0].projectId;
      }

      if (!projectId) {
        await whatsappService.sendMessage(
          phoneNumber,
          `📁 Select a project to view tasks:`
        );
        await projectService.listProjects(phoneNumber, 1);
        return { success: true, handled: true };
      }

      const project = await Project.findOne({ projectId, phoneNumber }).lean();

      if (project) {
        await taskService.showTasksMenu(phoneNumber, project);
      } else {
        await projectService.listProjects(phoneNumber, 1);
      }

      return { success: true, handled: true };
    } catch (error) {
      Logger.error("Error handling view tasks intent", error);
      return { success: false, handled: false };
    }
  }
}

module.exports = new FlowRouter();

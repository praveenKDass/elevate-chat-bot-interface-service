// ============================================
// FILE: services/flowRouter.js  (UPDATED – full file)
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
const languageService = require("./languageService");
const sessionService = require("./sessionService");

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
   * Main routing logic
   */
  async route(message) {
    try {
      const phoneNumber = message.from;

      // STEP 0: Track user activity
      await inactivityReminderService.trackUserActivity(phoneNumber);

      // STEP 0.5: Handle media evidence upload
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      if (lastMessage?.context?.uploadingEvidence && this.isMediaMessage(message)) {
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

      // STEP 1: Voice messages
      if (message.type === "audio" || message.type === "voice") {
        return await this.handleVoiceMessage(message, phoneNumber);
      }

      // STEP 2: Extract interactive responses
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

      Logger.debug("Extracted actions", { buttonResponse, listResponse, selectedAction });

      // STEP 3: Route interactive actions
      if (selectedAction) {
        // ── NEW: Language selection ───────────────────────────────────
        if (languageService.isLanguageButton(selectedAction)) {
          return await this.handleLanguageSelection(phoneNumber, selectedAction);
        }

        // ── NEW: Main menu session starters ──────────────────────────
        if (selectedAction === "capture_discussion") {
          return await this.handleSessionStart(phoneNumber, "discussion", message);
        }

        if (selectedAction === "record_story") {
          return await this.handleSessionStart(phoneNumber, "story", message);
        }

        // ── NEW: Forward Mohini option replies over WS ────────────────
        if (selectedAction.startsWith("mohini_opt_")) {
          // Format: mohini_opt_{index}_{value}
          const value = selectedAction.split("_").slice(3).join("_");
          const sent = sessionService.sendMessage(phoneNumber, value);
          if (!sent) {
            await whatsappService.sendMessage(
              phoneNumber,
              "⚠️ Session lost. Please type 'menu' to start again."
            );
          }
          return { success: true, handled: true };
        }

        // ── Existing: Program selection ───────────────────────────────
        if (selectedAction.startsWith("program_") && selectedAction !== "main_menu") {
          const programId = selectedAction.replace("program_", "");
          await programService.handleProgramSelection(phoneNumber, programId, message);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("report_type_")) {
          const reportType = parseInt(selectedAction.replace("report_type_", ""));
          await programService.handleReportTypeSelection(phoneNumber, reportType);
          return { success: true, handled: true };
        }

        if (
          selectedAction.startsWith("next_programs_") ||
          selectedAction.startsWith("prev_programs_")
        ) {
          let page = selectedAction.startsWith("next_programs_")
            ? parseInt(selectedAction.replace("next_programs_", ""))
            : parseInt(selectedAction.replace("prev_programs_", ""));
          await programService.handleProgramPagination(phoneNumber, null, page);
          return { success: true, handled: true };
        }

        if (
          selectedAction.startsWith("next_projects_") ||
          selectedAction.startsWith("prev_projects_")
        ) {
          await projectService.handleProjectPagination(phoneNumber, selectedAction);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("start_improvement_")) {
          const solutionId = selectedAction.replace("start_improvement_", "");
          const lastMsg = await usersQueries.getLastMessage(phoneNumber);
          const projectData = lastMsg?.context?.project;
          await projectService.handleStartImprovementProject(phoneNumber, solutionId, projectData);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("view_tasks_")) {
          const projectId = selectedAction.replace("view_tasks_", "");
          const projectData = await Project.findOne(
            { projectId, phoneNumber },
            { tasks: 1, projectName: 1, projectData: 1 }
          ).lean();
          if (!projectData) {
            await whatsappService.sendMessage(phoneNumber, "❌ Project not found.");
            return { success: false, handled: true };
          }
          await taskService.showTasksMenu(phoneNumber, projectData);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("update_task_")) {
          const projectId = selectedAction.replace("update_task_", "");
          const projectData = await Project.findOne(
            { projectId, phoneNumber },
            { tasks: 1, projectName: 1, projectData: 1 }
          ).lean();
          if (!projectData) {
            await whatsappService.sendMessage(phoneNumber, "❌ Project not found.");
            return { success: false, handled: true };
          }
          await taskService.showTaskSummary(phoneNumber, projectData.tasks, 1);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("view_resources_")) {
          const taskIndex = parseInt(selectedAction.replace("view_resources_", ""));
          await taskService.showTaskResources(phoneNumber, taskIndex);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("updated_task_status_")) {
          const taskIndex = parseInt(selectedAction.replace("updated_task_status_", ""));
          await taskService.showStatusUpdateMenu(phoneNumber, taskIndex);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("set_status_")) {
          const parts = selectedAction.replace("set_status_", "").split("_");
          const taskIndex = parseInt(parts[parts.length - 1]);
          const newStatus = parts.slice(0, -1).join("_");
          await taskService.handleStatusUpdate(phoneNumber, taskIndex, newStatus);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("upload_evidence_")) {
          const taskIndex = parseInt(selectedAction.replace("upload_evidence_", ""));
          await taskService.handleEvidenceUploadPrompt(phoneNumber, taskIndex);
          return { success: true, handled: true };
        }

        if (
          selectedAction.startsWith("tasks_next_") ||
          selectedAction.startsWith("tasks_prev_")
        ) {
          const page = selectedAction.startsWith("tasks_next_")
            ? parseInt(selectedAction.replace("tasks_next_", ""))
            : parseInt(selectedAction.replace("tasks_prev_", ""));
          await taskService.handleTaskPagination(phoneNumber, null, page);
          return { success: true, handled: true };
        }

        if (
          selectedAction.includes("solutionWithProject_") ||
          selectedAction.includes("solutionWithoutProject_")
        ) {
          await projectService.showProjectDetails(phoneNumber, message);
          return { success: true, handled: true };
        }

        if (
          selectedAction.startsWith("next_page_") ||
          selectedAction.startsWith("prev_page_")
        ) {
          await projectService.handleInteractiveResponse(phoneNumber, selectedAction);
          return { success: true, handled: true };
        }

        if (selectedAction.startsWith("view_report_")) {
          const projectId = selectedAction.replace("view_report_", "");
          await projectService.generateProjectReport(phoneNumber, projectId);
          return;
        }

        if (selectedAction.startsWith("view_certificate_")) {
          const lastMsg2 = await usersQueries.getLastMessage(phoneNumber);
          const project = lastMsg2?.context?.project;
          await projectService.showCertificateOptions(phoneNumber, project);
          return;
        }

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

        // ── Exact matches ─────────────────────────────────────────────
        switch (selectedAction) {
          case "view_analytics":
            await programService.showAnalyticsMenu(phoneNumber);
            return { success: true, handled: true };

          case "view_program_report":
            await programService.listPrograms(phoneNumber, 1);
            return { success: true, handled: true };

          case "start_new_project":
            await usersQueries.updateLastMessage(phoneNumber, {
              flow: "project_creation", step: 0, context: {}, text: "start_new_project",
            });
            await projectService.startNewProjectFlow(phoneNumber);
            return { success: true, handled: true };

          case "update_existing_project":
            await inactivityReminderService.resetReminderCount(phoneNumber);
            await projectService.listProjects(phoneNumber, 1);
            return { success: true, handled: true };

          case "record_another_story":
            await storyService.handleRecordAnotherStory(phoneNumber);
            return { success: true, handled: true };

          case "submit_improvement_project":
            await projectSubmissionService.submitImprovementProject(phoneNumber);
            return { success: true, handled: true };

          case "view_certificate":
            await projectSubmissionService.handleViewCertificate(phoneNumber);
            return { success: true, handled: true };

          case "share_certificate":
            await projectSubmissionService.handleShareCertificate(phoneNumber);
            return { success: true, handled: true };

          case "dismiss_reminder":
            await inactivityReminderService.handleReminderDismissal(phoneNumber);
            await whatsappService.sendMessage(phoneNumber, "✅ Reminder dismissed.");
            await inactivityReminderService.resetReminderCount(phoneNumber);
            return { success: true, handled: true };

          case "check_project_status":
            await inactivityReminderService.resetReminderCount(phoneNumber);
            await projectService.listProjects(phoneNumber, 1);
            return { success: true, handled: true };

          case "back_to_list":
            await projectService.handleBackToList(phoneNumber);
            return { success: true, handled: true };

          case "back_to_tasks": {
            const msg = await usersQueries.getLastMessage(phoneNumber);
            const projectId = msg?.context?.projectId;
            const projectData = await Project.findOne(
              { projectId, phoneNumber },
              { tasks: 1, projectName: 1, projectData: 1 }
            ).lean();
            if (!projectData) {
              await whatsappService.sendMessage(phoneNumber, "❌ Project not found.");
              return { success: false, handled: true };
            }
            await taskService.showTaskSummary(phoneNumber, projectData?.tasks || [], 1);
            return { success: true, handled: true };
          }

          case "back_to_project": {
            const lastMsg = await usersQueries.getLastMessage(phoneNumber);
            if (lastMsg?.context?.project) {
              await projectService.showProjectDetails(phoneNumber, lastMsg.context.project);
            } else {
              await projectService.listProjects(phoneNumber, 1);
            }
            return { success: true, handled: true };
          }

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

      // STEP 4: Text messages
      if (messageText) {
        // ── NEW: Forward text to active Mohini WS session ────────────
        if (sessionService.isConnected(phoneNumber)) {
          const sent = sessionService.sendMessage(phoneNumber, messageText);
          if (sent) {
            Logger.info("Text forwarded to Mohini WS", { phoneNumber });
            return { success: true, handled: true, route: "ws-forwarded" };
          }
        }

        // Evidence upload flow
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
            await whatsappService.sendMessage(phoneNumber, "❌ Evidence upload cancelled.");
            return { success: true, handled: true };
          }
        }

        // Task number selection
        if (lastMessage?.flow === "project_tasks" && /^\d+$/.test(messageText)) {
          const taskIndex = parseInt(messageText);
          const lastMsg = await usersQueries.getLastMessage(phoneNumber);
          const projectId = lastMsg?.context?.projectId;
          const projectData = await Project.findOne(
            { projectId, phoneNumber },
            { tasks: 1, projectName: 1, projectData: 1 }
          ).lean();
          if (!projectData) {
            await whatsappService.sendMessage(phoneNumber, "❌ Project not found.");
            return { success: false, handled: true };
          }
          const tasks = projectData.tasks;
          if (taskIndex > 0 && taskIndex <= tasks.length) {
            await taskService.showTaskDetails(phoneNumber, taskIndex);
          } else {
            await whatsappService.sendMessage(
              phoneNumber,
              `❌ Invalid task number. Choose between 1–${tasks.length}.`
            );
          }
          return { success: true, handled: true };
        }

        if (/^projects$/i.test(messageText)) {
          await projectService.listProjects(phoneNumber, 1);
          return { success: true, handled: true };
        }

        if (/^help$/i.test(messageText)) {
          await whatsappService.sendMessage(
            phoneNumber,
            "📋 Commands:\n• 'projects' – view all projects\n• 'menu' – main menu\n• 'cancel' – exit current flow"
          );
          return { success: true, handled: true };
        }

        if (/^menu$/i.test(messageText)) {
          await userService.handleUserMessage(message);
          return { success: true, handled: true };
        }

        if (/^(cancel|exit|stop|quit)$/i.test(messageText)) {
          // Close any active WS session
          await sessionService.closeConnection(phoneNumber);
          await usersQueries.clearLastMessage(phoneNumber);
          await whatsappService.sendMessage(phoneNumber, "❌ Cancelled. Type 'menu' to see options.");
          return { success: true, handled: true };
        }

        if (lastMessage?.flow === "improvement_project") {
          if (/^(submit|done|complete)$/i.test(messageText)) {
            await projectSubmissionService.submitImprovementProject(phoneNumber);
            return { success: true, handled: true };
          }
        }
      }

      // STEP 5: Fallback – user auth/registration check
      return await userService.handleUserMessage(message);
    } catch (error) {
      Logger.error("Flow routing error", error);
      await usersQueries.clearLastMessage(message.from);
      return { success: false, handled: false, error: error.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // ── NEW: Language selection handler ──────────────────────────────
  // ─────────────────────────────────────────────────────────────────
  async handleLanguageSelection(phoneNumber, langButtonId) {
    try {
      Logger.info("Language selected", { phoneNumber, langButtonId });

      await whatsappService.sendMessage(phoneNumber, "⏳ Setting up your language...");

      const { langLabel } = await languageService.fetchAndStore(
        phoneNumber,
        langButtonId
      );

      Logger.info("Translations stored", { phoneNumber, langLabel });

      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "main_menu",
        step: 0,
        context: { language: langLabel },
        text: langButtonId,
      });

      const mainMenuMsg = await languageService.buildMainMenuMessage(phoneNumber);
      await whatsappService.sendInteractiveMessage(mainMenuMsg);

      return { success: true, handled: true, stage: "main_menu" };
    } catch (error) {
      Logger.error("Language selection failed", { phoneNumber, error: error.message });
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Could not load language. Please try again."
      );
      return { success: false, handled: true };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // ── NEW: Session start → WebSocket open ──────────────────────────
  // ─────────────────────────────────────────────────────────────────
  async handleSessionStart(phoneNumber, sessionType, message) {
    try {
      Logger.info("Starting Mohini session", { phoneNumber, sessionType });

      // 1. Create REST session
      const sessionResult = await sessionService.createSession(
        phoneNumber,
        sessionType
      );

      if (!sessionResult.success) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Could not start session. Please try again in a moment."
        );
        return { success: false, handled: true };
      }

      // 2. Open WebSocket
      const wsResult = await sessionService.openConnection(phoneNumber);

      if (!wsResult.success) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ Connection failed. Please try again.`
        );
        return { success: false, handled: true };
      }

      // 3. Persist flow state
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: sessionType === "discussion" ? "capture_discussion" : "story_recording",
        step: 1,
        context: {
          sessionId: sessionResult.session.sessionid,
          sessionType,
        },
        text: sessionType,
      });

      Logger.info("Session + WS active", {
        phoneNumber,
        sessionType,
        sessionId: sessionResult.session.sessionid,
      });

      // Mohini's first message will arrive via the WS handler
      // and be forwarded to WhatsApp automatically.
      return { success: true, handled: true, stage: "session_active" };
    } catch (error) {
      Logger.error("Session start error", { phoneNumber, error: error.message });
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to start session. Type 'menu' to try again."
      );
      return { success: false, handled: true };
    }
  }

  // ─────────────────────────────────────────
  // Existing helpers (unchanged)
  // ─────────────────────────────────────────
  async handleMediaUpload(message, phoneNumber) {
    try {
      const result = await fileUploadService.handleEvidenceUpload(phoneNumber, message);
      return { success: result.success, handled: true };
    } catch (error) {
      Logger.error("Media upload error", error);
      await whatsappService.sendMessage(phoneNumber, "❌ Failed to upload evidence.");
      return { success: false, handled: true };
    }
  }

  async handleEvidenceUploadComplete(phoneNumber) {
    try {
      const result = await fileUploadService.finishEvidenceUpload(phoneNumber);
      return { success: result.success, handled: true };
    } catch (error) {
      return { success: false, handled: true };
    }
  }

  isMediaMessage(message) {
    return ["image", "video", "audio", "document"].includes(message.type);
  }

  async handleVoiceMessage(message, phoneNumber) {
    try {
      await whatsappService.sendMessage(phoneNumber, "🎤 Processing your voice message...");

      // If there's an active WS session, transcribe and forward
      if (sessionService.isConnected(phoneNumber)) {
        // (Optional) Transcribe first, then send as text
        // For now, inform user to type
        await whatsappService.sendMessage(
          phoneNumber,
          "Please type your response for now."
        );
        return { success: true, handled: true };
      }

      // Existing voice handling for non-session flows
      return { success: true, handled: true };
    } catch (error) {
      Logger.error("Voice handling error", error);
      return { success: false, handled: true };
    }
  }
}

module.exports = new FlowRouter();
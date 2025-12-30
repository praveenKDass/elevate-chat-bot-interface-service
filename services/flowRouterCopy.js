// ============================================
// FILE: services/flowRouter.js - SIMPLIFIED FOR MCP
// Only handles: Interactive messages & Simple Commands
// Natural Language/Audio goes to MessageController → Claude → MCP
// ============================================
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const inactivityReminderService = require("./inactivityReminderService");
const userService = require("./userService");
const projectService = require("./projectService");
const taskService = require("./taskService");
const storyService = require("./storyService");
const programService = require("./programService");
const projectSubmissionService = require("./projectSubmissionService");
const Project = require("../database/models/project");
const fileUploadService = require("./fileUploadService");

class FlowRouterCopy {
  constructor() {
    this.flowHandlers = {
      registration: userService,
      project_creation: projectService,
      project_update: projectService,
      project_tasks: taskService,
      improvement_project: taskService,
      analytics: programService,
      story_recording: storyService,
    };
  }

  /**
   * Main routing - handles ONLY:
   * 1. Interactive messages (buttons/lists)
   * 2. Simple text commands
   * 3. Media uploads (evidence)
   * 4. Structured flows (registration, project creation, etc.)
   *
   * Natural Language & Audio go to MessageController instead
   */
  async route(message) {
    try {
      const phoneNumber = message.from;

      // Track user activity
      await inactivityReminderService.trackUserActivity(phoneNumber);

      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const messageText = message.text?.body?.trim() || "";

      Logger.info("FlowRouter: Processing message", {
        phoneNumber,
        type: message.type,
        messageText: messageText.substring(0, 30),
      });

      // ============================================
      // HANDLE MEDIA UPLOADS (Evidence)
      // ============================================
      if (
        lastMessage?.context?.uploadingEvidence &&
        this.isMediaMessage(message)
      ) {
        return await this.handleMediaUpload(message, phoneNumber);
      }

      // ============================================
      // HANDLE EVIDENCE UPLOAD TEXT COMMANDS
      // ============================================
      if (messageText && lastMessage?.context?.uploadingEvidence) {
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

      // ============================================
      // EXTRACT INTERACTIVE RESPONSES (Buttons/Lists)
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

      Logger.debug("FlowRouter: Extracted actions", {
        buttonResponse,
        listResponse,
        selectedAction,
      });

      // ============================================
      // ROUTE INTERACTIVE ACTIONS
      // ============================================
      if (selectedAction) {
        return await this.handleInteractiveAction(
          selectedAction,
          phoneNumber,
          lastMessage
        );
      }

      // ============================================
      // HANDLE TEXT COMMANDS (Simple commands only)
      // Natural Language goes to MessageController
      // ============================================
      if (messageText) {
        // Task number selection (in context of project_tasks flow)
        if (
          lastMessage?.flow === "project_tasks" &&
          /^\d+$/.test(messageText)
        ) {
          const taskIndex = parseInt(messageText);
          const projectId = lastMessage?.context?.projectId;
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

        // Simple text commands
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
            await projectSubmissionService.submitImprovementProject(phoneNumber);
            return { success: true, handled: true };
          }
        }
      }

      // ============================================
      // DEFAULT: User authentication/registration
      // ============================================
      return await userService.handleUserMessage(message);
    } catch (error) {
      Logger.error("FlowRouter: Routing error", error);
      await usersQueries.clearLastMessage(message.from);
      return { success: false, handled: false, error: error.message };
    }
  }

  /**
   * Handle interactive button/list actions
   */
  async handleInteractiveAction(selectedAction, phoneNumber, lastMessage) {
    try {
      Logger.info("FlowRouter: Handling interactive action", {
        action: selectedAction,
        phoneNumber,
      });

      // ============================================
      // PROGRAM ACTIONS
      // ============================================
      if (
        selectedAction.startsWith("program_") &&
        selectedAction !== "main_menu"
      ) {
        const programId = selectedAction.replace("program_", "");
        await programService.handleProgramSelection(
          phoneNumber,
          programId,
          {}
        );
        return { success: true, handled: true };
      }

      if (selectedAction.startsWith("report_type_")) {
        const reportType = parseInt(selectedAction.replace("report_type_", ""));
        await programService.handleReportTypeSelection(phoneNumber, reportType);
        return { success: true, handled: true };
      }

      if (selectedAction.startsWith("next_programs_")) {
        const page = parseInt(selectedAction.replace("next_programs_", ""));
        await programService.handleProgramPagination(phoneNumber, null, page);
        return { success: true, handled: true };
      }

      if (selectedAction.startsWith("prev_programs_")) {
        const page = parseInt(selectedAction.replace("prev_programs_", ""));
        await programService.handleProgramPagination(phoneNumber, null, page);
        return { success: true, handled: true };
      }

      // ============================================
      // PROJECT ACTIONS
      // ============================================
      if (selectedAction.startsWith("next_projects_")) {
        await projectService.handleProjectPagination(
          phoneNumber,
          selectedAction
        );
        return { success: true, handled: true };
      }

      if (selectedAction.startsWith("prev_projects_")) {
        await projectService.handleProjectPagination(
          phoneNumber,
          selectedAction
        );
        return { success: true, handled: true };
      }

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

      // ============================================
      // TASK ACTIONS
      // ============================================
      if (selectedAction.startsWith("view_resources_")) {
        const taskIndex = parseInt(
          selectedAction.replace("view_resources_", "")
        );
        await taskService.showTaskResources(phoneNumber, taskIndex);
        return { success: true, handled: true };
      }

      if (selectedAction.startsWith("updated_task_status_")) {
        const taskIndex = parseInt(
          selectedAction.replace("updated_task_status_", "")
        );
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
        const taskIndex = parseInt(
          selectedAction.replace("upload_evidence_", "")
        );
        await taskService.handleEvidenceUploadPrompt(phoneNumber, taskIndex);
        return { success: true, handled: true };
      }

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

      // ============================================
      // PAGE NAVIGATION
      // ============================================
      if (selectedAction.startsWith("next_page_")) {
        await projectService.handleInteractiveResponse(
          phoneNumber,
          selectedAction
        );
        return { success: true, handled: true };
      }

      if (selectedAction.startsWith("prev_page_")) {
        await projectService.handleInteractiveResponse(
          phoneNumber,
          selectedAction
        );
        return { success: true, handled: true };
      }

      // ============================================
      // CERTIFICATE ACTIONS
      // ============================================
      if (selectedAction.startsWith("view_certificate_")) {
        const projectId = selectedAction.replace("view_certificate_", "");
        const lastMsg = await usersQueries.getLastMessage(phoneNumber);
        const project = lastMsg?.context?.project;
        await projectService.showCertificateOptions(phoneNumber, project);
        return { success: true, handled: true };
      }

      if (selectedAction.startsWith("cert_pdf_")) {
        const projectId = selectedAction.replace("cert_pdf_", "");
        await projectService.sendCertificate(phoneNumber, projectId, "pdf");
        return { success: true, handled: true };
      }

      if (selectedAction.startsWith("cert_svg_")) {
        const projectId = selectedAction.replace("cert_svg_", "");
        await projectService.sendCertificate(phoneNumber, projectId, "svg");
        return { success: true, handled: true };
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
          await userService.handleUserMessage({});
          return { success: true, handled: true };

        case "view_report_":
          const reportProjectId = selectedAction.replace("view_report_", "");
          await projectService.generateProjectReport(
            phoneNumber,
            reportProjectId
          );
          return { success: true, handled: true };

        default:
          await whatsappService.sendMessage(
            phoneNumber,
            "❌ Sorry, I didn't recognize that option. Please try again."
          );
          return { success: true, handled: true };
      }
    } catch (error) {
      Logger.error("FlowRouter: Error handling interactive action", error);
      return { success: false, handled: true, error: error.message };
    }
  }

  /**
   * Handle media upload for evidence
   */
  async handleMediaUpload(message, phoneNumber) {
    try {
      Logger.info("FlowRouter: Processing evidence upload", {
        phoneNumber,
        type: message.type,
      });

      const result = await fileUploadService.handleEvidenceUpload(
        phoneNumber,
        message
      );

      return { success: result.success, handled: true };
    } catch (error) {
      Logger.error("FlowRouter: Media upload error", error);
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
      Logger.error("FlowRouter: Error completing upload", error);
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
}

module.exports = new FlowRouterCopy();
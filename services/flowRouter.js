// ============================================
// FILE: services/flowRouter.js
// ============================================
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const inactivityReminderService = require("./inactivityReminderService");
const programService = require("./programService");

// Import all your flow services
const userService = require("./userService");
const projectService = require("./projectService");
const registrationFlow = require("./registrationFlow");
const storyService = require("./storyService");
// const analyticsService = require("./analyticsService");
// const profileService = require("./profileService");

class FlowRouter {
  constructor() {
    // Define flow handlers mapping
    this.flowHandlers = {
      registration: registrationFlow,
      project_creation: projectService,
      project_update: projectService,
      // story_recording: storyService,
      // analytics: analyticsService,
      // profile_update: profileService,
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

      const messageText = message.text?.body?.trim() || "";

      // ============================================
      // STEP 1: Check if user has an active flow
      // ============================================
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      console.log(message, "this is message");
      Logger.info("Flow routing check", {
        phoneNumber,
        hasActiveFlow: !!lastMessage?.flow,
        currentFlow: lastMessage?.flow || "none",
        currentStep: lastMessage?.step || 0,
      });

      // ============================================
      // STEP 2: Handle active flow continuations
      // ============================================
      // if (lastMessage?.flow) {
      //   const flowHandler = this.flowHandlers[lastMessage.flow];

      //   if (flowHandler) {
      //     Logger.info(`Continuing flow: ${lastMessage.flow}`, {
      //       phoneNumber,
      //       step: lastMessage.step,
      //     });

      //     // Route to appropriate flow handler based on flow type
      //     return await this.handleFlowContinuation(
      //       message,
      //       lastMessage,
      //       flowHandler
      //     );
      //   } else {
      //     Logger.warn(`Unknown flow: ${lastMessage.flow}`, { phoneNumber });
      //     await usersQueries.clearLastMessage(phoneNumber);
      //   }
      // }

      // ============================================
      // STEP 3: Handle interactive button/list responses (NEW FLOWS)
      // ============================================
      // const buttonResponse =
      //   message?.interactive?.button_reply?.id ||
      //   message?.reply?.button_reply?.id;

      // const listResponse =
      //   message?.interactive?.list_reply?.id || message?.reply?.list_reply?.id;

      // const selectedAction = (buttonResponse || listResponse)?.replace(
      //   /^ListV3:/,
      //   ""
      // );
      // Extract button response (button clicks)
      const buttonResponse =
        message?.interactive?.buttons_reply?.id ||
        message?.reply?.buttons_reply?.id ||
        message?.buttons_reply?.id;

      // Extract list response (list item selections)
      const listResponse =
        message?.interactive?.list_reply?.id ||
        message?.reply?.list_reply?.id ||
        message?.list_reply?.id;

      // Get the selected action and clean it
      let selectedAction = buttonResponse || listResponse;

      if (selectedAction) {
        // Remove prefixes like "ButtonsV3:", "ListV3:"
        selectedAction = selectedAction
          .replace(/^ButtonsV3:/, "")
          .replace(/^ListV3:/, "");
      }

      console.log(
        { buttonResponse, listResponse, selectedAction },
        "flow action values"
      );
      console.log(selectedAction, "this is elected action");
      if (
        selectedAction &&
        selectedAction != "main_menu" &&
        selectedAction != "cancel_story_recording"
      ) {
        return await this.handleInteractiveAction(
          phoneNumber,
          selectedAction,
          message
        );
      }

      // ============================================
      // STEP 4: Handle text commands (shortcuts)
      // ============================================
      if (messageText) {
        return await this.handleTextCommand(phoneNumber, messageText, message);
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
   * Continue existing flow based on last message state
   */
  async handleFlowContinuation(message, lastMessage, flowHandler) {
    const phoneNumber = message.from;
    const messageText = message.text?.body?.trim() || "";

    try {
      // Check if user wants to cancel
      if (/^(cancel|exit|stop|quit)$/i.test(messageText)) {
        await usersQueries.clearLastMessage(phoneNumber);
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Flow cancelled. How can I help you?"
        );
        return { success: true, handled: true, cancelled: true };
      }

      // Route to specific flow handler
      switch (lastMessage.flow) {
        case "registration":
          const user = await usersQueries.findOne({ phoneNumber });
          await registrationFlow.handle(
            user,
            messageText,
            whatsappService.sendMessage
          );
          return { success: true, handled: true };

        case "project_creation":
          await projectService.handleProjectCreationFlow(
            phoneNumber,
            messageText,
            lastMessage
          );
          return { success: true, handled: true };

        case "project_browse":
          await projectService.handleProjectBrowseFlow(
            phoneNumber,
            messageText,
            lastMessage
          );
          return { success: true, handled: true };

        case "project_detail":
          // Handle actions from project detail view
          await projectService.handleInteractiveResponse(
            phoneNumber,
            messageText
          );
          return { success: true, handled: true };

        case "project_update":
          await projectService.handleProjectUpdateFlow(
            phoneNumber,
            messageText,
            lastMessage
          );
          return { success: true, handled: true };

        // Add more flow handlers here...

        default:
          Logger.warn(`Unhandled flow: ${lastMessage.flow}`);
          await usersQueries.clearLastMessage(phoneNumber);
          return { success: false, handled: false };
      }
    } catch (error) {
      Logger.error("Flow continuation error", error);
      await usersQueries.clearLastMessage(phoneNumber);
      throw error;
    }
  }

  /**
   * Handle interactive button/list selections (starting new flows)
   */
  async handleInteractiveAction(phoneNumber, selectedAction, message) {
    Logger.info("Received interactive selection", {
      selectedAction,
      phoneNumber,
    });

    try {
      // Handle program selection (program_XXXXX format)
      if (
        selectedAction.includes("program_") &&
        selectedAction.startsWith("program_")
      ) {
        const programId = selectedAction.replace("program_", "");
        await programService.handleProgramSelection(
          phoneNumber,
          programId,
          message
        );
        return { success: true, handled: true };
      }

      // Handle report type selection (report_type_X format)
      if (selectedAction.startsWith("report_type_")) {
        const reportTypeStr = selectedAction.replace("report_type_", "");
        const reportType = parseInt(reportTypeStr);
        await programService.handleReportTypeSelection(phoneNumber, reportType);
        return { success: true, handled: true };
      }

      // ============================================
      // NEW: Handle program pagination
      // ============================================
      if (
        selectedAction.startsWith("next_programs_") ||
        selectedAction.startsWith("prev_programs_")
      ) {
        await programService.handleProgramPagination(
          phoneNumber,
          selectedAction
        );
        return { success: true, handled: true };
      }
      // Handle project selection from list (both types)
      if (
        selectedAction.includes("solutionWithProject_") ||
        selectedAction.includes("solutionWithoutProject_")
      ) {
        await projectService.showProjectDetails(phoneNumber, message);
        return { success: true, handled: true };
      }

      switch (selectedAction) {
        case "start_new_project":
          // Set flow state before starting
          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "project_creation",
            step: 0,
            context: {},
            text: "start_new_project",
          });
          await projectService.startNewProjectFlow(phoneNumber);
          break;

        case "update_existing_project":
          // Don't set flow state here - listProjects will do it
          // Reset reminder count as user is now active
          await inactivityReminderService.resetReminderCount(phoneNumber);
          await projectService.listProjects(phoneNumber, 1);
          break;

        case "confirm_update":
          const lastMsg = await usersQueries.getLastMessage(phoneNumber);
          if (lastMsg?.context?.projectId && lastMsg?.context?.newValue) {
            // TODO: Make actual API call to update project
            Logger.info("Updating project", {
              projectId: lastMsg.context.projectId,
              field: lastMsg.context.fieldToUpdate,
              newValue: lastMsg.context.newValue,
            });

            await whatsappService.sendMessage(
              phoneNumber,
              "✅ *Project updated successfully!*\n\nType 'projects' to view all projects."
            );
            await usersQueries.clearLastMessage(phoneNumber);
          }
          break;

        case "cancel_update":
          await usersQueries.clearLastMessage(phoneNumber);
          await whatsappService.sendMessage(
            phoneNumber,
            "❌ Update cancelled. Type 'menu' to see options."
          );
          break;

        // case "record_story":
        // await usersQueries.updateLastMessage(phoneNumber, {
        //   flow: "story_recording",
        //   step: 0,
        //   context: {},
        //   text: "record_story",
        // });
        // // await storyService.startStoryRecording(phoneNumber);
        // await whatsappService.sendInteractiveMessage({
        //   to: phoneNumber,
        //   type: "button",
        //   body: {
        //     text: "📚 Record Your Story\n\nClick the button below to record your story:",
        //   },
        //   action: {
        //     buttons: [
        //       {
        //         type: "url",
        //         title: "🎙️ Record Story",
        //         id: "open_recording_link",
        //         url: "https://qa.elevate-mitra.shikshalokam.org/mohini/home",
        //       },
        //     ],
        //   },
        // });

        // break;

        case "record_story":
          // Now using the dedicated storyService
          await storyService.startStoryRecording(phoneNumber);
          break;

        case "record_another_story":
          // User wants to record another story
          await storyService.handleRecordAnotherStory(phoneNumber);
          break;

        case "update_profile":
          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "profile_update",
            step: 0,
            context: {},
            text: "update_profile",
          });
          // await profileService.startProfileUpdate(phoneNumber);
          break;

        case "dismiss_reminder":
          // Handle reminder dismissal
          await inactivityReminderService.handleReminderDismissal(phoneNumber);
          await whatsappService.sendMessage(
            phoneNumber,
            "✅ Reminder dismissed. Let me know if you need help!"
          );
          // Reset reminder count when user acknowledges
          await inactivityReminderService.resetReminderCount(phoneNumber);
          break;

        case "check_project_status":
          // Handle check project status from reminder
          // Reset reminder count as user is now active
          await inactivityReminderService.resetReminderCount(phoneNumber);
          await projectService.listProjects(phoneNumber, 1);
          break;

        case selectedAction.includes("project_"):
          await projectService.showProjectDetails(phoneNumber, message);
          break;

        case "back_to_list":
          await projectService.handleBackToList(phoneNumber);
          break;
        //view analytics
        case "view_analytics":
          await programService.showAnalyticsMenu(phoneNumber);
          break;
        //get reports
        case "view_program_report":
          await programService.listPrograms(phoneNumber);
          break;

        // Handle pagination (e.g., "next_page_2", "prev_page_1")
        default:
          if (/^(next_page_|prev_page_)/.test(selectedAction)) {
            await projectService.handleInteractiveResponse(
              phoneNumber,
              selectedAction
            );
          } else {
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Sorry, I didn't recognize that option. Please try again."
            );
          }
          break;
      }

      return { success: true, handled: true };
    } catch (error) {
      Logger.error("Interactive action error", error);
      throw error;
    }
  }

  /**
   * Handle text-based commands (shortcuts like "projects", "help", etc.)
   */
  async handleTextCommand(phoneNumber, messageText, message) {
    // Check for specific commands
    if (/^projects$/i.test(messageText)) {
      await projectService.listProjects(phoneNumber, 1);
      return { success: true, handled: true };
    }

    if (/^help$/i.test(messageText)) {
      await whatsappService.sendMessage(
        phoneNumber,
        "📋 Available commands:\n" +
          "• Type 'projects' to view all projects\n" +
          "• Type 'menu' to see main menu\n" +
          "• Type 'cancel' to exit current flow"
      );
      return { success: true, handled: true };
    }

    if (/^menu$/i.test(messageText)) {
      await userService.handleUserMessage(message);
      return { success: true, handled: true };
    }

    // If no command matches, let userService handle it (registration/auth check)
    return await userService.handleUserMessage(message);
  }
}

module.exports = new FlowRouter();

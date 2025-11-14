// ============================================
// FILE: services/projectService.js
// ============================================
const whatsappService = require("./whatsappService");
const usersQueries = require("../database/databaseQueries/userQueries");
const Logger = require("../utils/logger");
const config = require("../config/config");
const { makeApiRequest } = require("../generics/services/axios");

class ProjectService {
  constructor() {
    this.apiBaseUrl = config.backend.apiUrl;
  }

  getHeaders() {
    return {
      "content-type": "application/json",
      "x-auth-token":
        process.env.ELEVATE_AUTH_TOKEN ||
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlkIjoyODU1LCJuYW1lIjoic2dmdW5jdGlvbmFyaWVzIHNnb2ZmaWNpYWwiLCJzZXNzaW9uX2lkIjoyMjM1NSwib3JnYW5pemF0aW9uX2lkcyI6WyIzOSJdLCJvcmdhbml6YXRpb25fY29kZXMiOlsidHJpcHVyYSJdLCJ0ZW5hbnRfY29kZSI6InNoaWtzaGFncmFoYW5ldyIsIm9yZ2FuaXphdGlvbnMiOlt7ImlkIjozOSwibmFtZSI6IlRyaXB1cmEiLCJjb2RlIjoidHJpcHVyYSIsImRlc2NyaXB0aW9uIjoidHJpcHVyYSBzdGF0ZSBhcyBhbiBvcmdhbml6YXRpb24gdGVzdCBpbiBTRyIsInN0YXR1cyI6IkFDVElWRSIsInJlbGF0ZWRfb3JncyI6W10sInRlbmFudF9jb2RlIjoic2hpa3NoYWdyYWhhbmV3IiwibWV0YSI6bnVsbCwiY3JlYXRlZF9ieSI6MSwidXBkYXRlZF9ieSI6Mzc3LCJyb2xlcyI6W3siaWQiOjc3LCJ0aXRsZSI6Im1lbnRlZSIsImxhYmVsIjoibWVudGVlIiwidXNlcl90eXBlIjowLCJzdGF0dXMiOiJBQ1RJVkUiLCJvcmdhbml6YXRpb25faWQiOjM1LCJ2aXNpYmlsaXR5IjoiUFVCTElDIiwidGVuYW50X2NvZGUiOiJzaGlrc2hhZ3JhaGFuZXciLCJ0cmFuc2xhdGlvbnMiOm51bGx9XX1dfSwiaWF0IjoxNzYyODQ2NjI3LCJleHAiOjE3NjI5MzMwMjd9.njm8kuA676wnDyVoJ1l9HxrOHECG_fiaj9fVKo6IHJw",
      origin: this.apiBaseUrl,
    };
  }

  /**
   * Start new project creation flow
   */
  async startNewProjectFlow(phoneNumber) {
    try {
      // Set flow state
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_creation",
        step: 1, // Ask for project name
        context: {},
        text: "start_new_project",
      });

      await whatsappService.sendMessage(
        phoneNumber,
        "🎯 *Let's create a new project!*\n\n" +
          "Please enter the *project name*:\n\n" +
          "_(Type 'cancel' anytime to exit)_"
      );

      Logger.info("Started project creation flow", { phoneNumber });
    } catch (error) {
      Logger.error("Error starting project flow", error);
      throw error;
    }
  }

  /**
   * Handle project browsing flow (when user selects a project number)
   */
  async handleProjectBrowseFlow(phoneNumber, messageText, lastMessage) {
    try {
      const step = lastMessage.step || 1;
      const context = lastMessage.context || {};

      Logger.info("Project browse flow", { phoneNumber, step, messageText });

      // User typed a project number
      if (step === 1 && /^\d+$/.test(messageText.trim())) {
        const projectNumber = parseInt(messageText.trim());
        const projectKey = `project_${projectNumber}`;
        const projectId = context.projectMap?.[projectKey];

        if (!projectId) {
          await whatsappService.sendMessage(
            phoneNumber,
            `❌ Invalid project number. Please select between 1-${
              context.totalProjects || 5
            }.`
          );
          return;
        }

        // Fetch project details
        await this.showProjectDetails(phoneNumber, projectId);
        return;
      }

      // If unrecognized input, prompt again
      await whatsappService.sendMessage(
        phoneNumber,
        "Please enter a valid project number or use the navigation buttons."
      );
    } catch (error) {
      Logger.error("Error in project browse flow", error);
      await usersQueries.clearLastMessage(phoneNumber);
      throw error;
    }
  }

  /**
   * Show detailed view of a single project
   */

  async showProjectDetails(phoneNumber, message) {
    try {
      let projectId, solutionId, projectType;

      // Extract the full selectedId from the message
      // Format: "ListV3:solutionWithProject_<id>" or "ListV3:solutionWithoutProject_<id>"
      let selectedId;
      console.log(message, "this is message");
      if (message.reply?.list_reply?.id) {
        selectedId = message.reply.list_reply.id;
      } else if (message.interactive?.list_reply?.id) {
        selectedId = message.interactive.list_reply.id;
      }

      if (!selectedId) {
        Logger.warn("Invalid project selection - no selectedId found", {
          phoneNumber,
        });
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ Invalid project selection. Please try again.`
        );
        await this.listProjects(phoneNumber, 1);
        return;
      }

      // Remove "ListV3:" prefix if present
      const cleanId = selectedId.replace(/^ListV3:/, "");

      // Retrieve project data from the stored project mapping
      // const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      // const projectMap = lastMessage?.context?.projectMap || {};
      // console.log(projectMap,"this is map")
      // const projectData = projectMap[cleanId];

      // if (!projectData) {
      //   Logger.warn("Project data not found in map", {
      //     phoneNumber,
      //     cleanId,
      //     mapKeys: Object.keys(projectMap),
      //   });
      //   await whatsappService.sendMessage(
      //     phoneNumber,
      //     `❌ Invalid project selection. Please try again.`
      //   );
      //   await this.listProjects(phoneNumber, 1);
      //   return;
      // }
      if (selectedId) {
        // Remove prefix like "ListV3:" if present
        const cleanedId = selectedId.replace(/^ListV3:/, "");

        // Split type and id
        const [type, id] = cleanedId.split("_");

        projectType = type;

        if (projectType === "solutionWithProject") {
          projectId = id;
        } else if (projectType === "solutionWithoutProject") {
          solutionId = id;
        } else {
          console.warn("Unknown project type:", projectType);
        }
      }

      // projectId = projectData.projectId;
      // solutionId = projectData.solutionId;
      // projectType = projectData.type; // "solutionWithProject" or "solutionWithoutProject"

      Logger.info("Project selected", {
        phoneNumber,
        projectId,
        solutionId,
        projectType,
        cleanId,
      });

      Logger.info("Fetching project details", {
        phoneNumber,
        projectId,
        solutionId,
        projectType,
      });

      // Determine endpoint based on project type
      let url;
      if (projectType === "solutionWithProject") {
        url = `${this.apiBaseUrl}/project/v1/userProjects/details/${projectId}`;
      } else if (projectType === "solutionWithoutProject") {
        url = `${this.apiBaseUrl}/project/v1/solutions/details/${solutionId}`;
      } else {
        throw new Error(`Unknown project type: ${projectType}`);
      }

      Logger.info("API endpoint determined", { projectType, url });

      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        {
          state: "6852c86c7248c20014b38a4d",
          district: "6852c8ae7248c20014b38a57",
          block: "6852c8de7248c20014b38a9d",
          cluster: "6852c9027248c20014b38c34",
          school: "6852c9237248c20014b39fa0",
          professional_role: "6825950197b5680013e6a17c",
          professional_subroles:
            "6825ad1f97b5680013e8450b,6825ad1f97b5680013e8450c",
          organizations: "[object Object]",
        }
      );

      const project = response?.data?.result || response?.data;

      if (!project) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Failed to load project details. Please try again."
        );
        await this.listProjects(phoneNumber, 1);
        await usersQueries.clearLastMessage(phoneNumber);
        return;
      }

      // Update flow state to project detail view
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_detail",
        step: 0,
        context: { projectId, solutionId, project },
        text: `view_project_${projectId}`,
      });

      // Format project details message
      const detailsText =
        `*📁 ${project.title ?? project.name}*\n\n` +
        `${project.description ? `${project.description}\n\n` : ""}` +
        `*Duration:* ${project.duration || "N/A"}\n` +
        `*Status:* ${project.status || "Unknown"}\n` +
        `\nWhat would you like to do?`;

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        header: {
          text: "Project Details",
        },
        body: {
          text: detailsText,
        },
        footer: {
          text: "Powered by ShikshaLokam",
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "Update_Task",
              id: "update_task",
            },
            {
              type: "quick_reply",
              title: "⬅️ Back to List",
              id: "back_to_list",
            },
            {
              type: "quick_reply",
              title: "🏠 Main Menu",
              id: "main_menu",
            },
          ],
        },
      });

      Logger.info("Project details shown", { phoneNumber, projectId });
    } catch (error) {
      Logger.error("Error showing project details", error);

      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Something went wrong. Showing your projects again..."
      );

      await this.listProjects(phoneNumber, 1);
      await usersQueries.clearLastMessage(phoneNumber);
    }
  }

  // Helper method to handle back to list action
  async handleBackToList(phoneNumber) {
    try {
      await usersQueries.clearLastMessage(phoneNumber);
      await this.listProjects(phoneNumber, 1);
    } catch (error) {
      Logger.error("Error going back to list", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to load projects list."
      );
    }
  }

  /**
   * Handle project creation flow steps
   */
  async handleProjectCreationFlow(phoneNumber, messageText, lastMessage) {
    try {
      const step = lastMessage.step || 1;
      const context = lastMessage.context || {};

      Logger.info("Project creation flow", { phoneNumber, step, messageText });

      switch (step) {
        case 1: // Received project name
          context.projectName = messageText.trim();

          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "project_creation",
            step: 2, // Ask for description
            context,
            text: messageText,
          });

          await whatsappService.sendMessage(
            phoneNumber,
            `✅ Great! Project name: *${context.projectName}*\n\n` +
              "Now, please provide a *description* for your project:"
          );
          break;

        case 2: // Received description
          context.projectDescription = messageText.trim();

          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "project_creation",
            step: 3, // Ask for start date
            context,
            text: messageText,
          });

          await whatsappService.sendMessage(
            phoneNumber,
            "📅 When does the project start?\n\n" +
              "Please provide the date in format: *DD/MM/YYYY*\n" +
              "Example: 15/12/2024"
          );
          break;

        case 3: // Received start date
          // Validate date format
          if (!/^\d{2}\/\d{2}\/\d{4}$/.test(messageText)) {
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Invalid date format. Please use *DD/MM/YYYY*\n" +
                "Example: 15/12/2024"
            );
            return;
          }

          context.startDate = messageText.trim();

          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "project_creation",
            step: 4, // Confirmation
            context,
            text: messageText,
          });

          // Show confirmation
          await whatsappService.sendInteractiveMessage({
            to: phoneNumber,
            type: "button",
            body: {
              text:
                "📋 *Project Summary*\n\n" +
                `*Name:* ${context.projectName}\n` +
                `*Description:* ${context.projectDescription}\n` +
                `*Start Date:* ${context.startDate}\n\n` +
                "Is this correct?",
            },
            action: {
              buttons: [
                {
                  type: "reply",
                  reply: { id: "confirm_project", title: "✅ Confirm" },
                },
                {
                  type: "reply",
                  reply: { id: "cancel_project", title: "❌ Cancel" },
                },
              ],
            },
          });
          break;

        default:
          Logger.warn("Unknown project creation step", { step });
          await usersQueries.clearLastMessage(phoneNumber);
          break;
      }
    } catch (error) {
      Logger.error("Error in project creation flow", error);
      await usersQueries.clearLastMessage(phoneNumber);
      throw error;
    }
  }

  /**
   * List user's projects with pagination
   */
  /**
   * List user's projects with pagination
   */
  async listProjects(phoneNumber, page = 1) {
    try {
      const url = `${this.apiBaseUrl}/project/v1/solutions/targetedSolutions?type=improvementProject&page=1&limit=30&filter=assignedToMe`;
      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        {
          state: "6852c86c7248c20014b38a4d",
          district: "6852c8ae7248c20014b38a57",
          block: "6852c8de7248c20014b38a9d",
          cluster: "6852c9027248c20014b38c34",
          school: "6852c9237248c20014b39fa0",
          professional_role: "6825950197b5680013e6a17c",
          professional_subroles:
            "6825ad1f97b5680013e8450b,6825ad1f97b5680013e8450c",
          organizations: "[object Object]",
        }
      );

      const projects = response?.data?.result?.data;
      const itemsPerPage = 5;
      const totalPages = Math.ceil(projects.length / itemsPerPage);
      const start = (page - 1) * itemsPerPage;
      const paginatedProjects = projects.slice(start, start + itemsPerPage);

      if (paginatedProjects.length === 0) {
        await whatsappService.sendMessage(
          phoneNumber,
          "📂 You don't have any projects yet.\n\n" +
            "Would you like to create one?"
        );
        await usersQueries.clearLastMessage(phoneNumber);
        return;
      }

      // Create a mapping of projectId to full project data (including solutionId)
      const projectMap = {};
      const listItems = paginatedProjects.map((project) => {
        // Determine if this is a project with solution or solution without project
        const hasProjectId = project?._id && project._id.trim() !== "";
        const projectId = hasProjectId ? project._id : project?.solutionId;

        // Determine the type for endpoint routing
        const type = hasProjectId
          ? "solutionWithProject"
          : "solutionWithoutProject";

        // Store the full project data for later retrieval
        projectMap[`${type}_${projectId}`] = {
          projectId: project._id,
          solutionId: project.solutionId,
          name: project.name,
          description: project.description,
          type, // Store type for routing
        };

        return {
          id: `${type}_${projectId}`,
          title: project.name,
          description: `Status: ${project.description}`,
        };
      });
      console.log(projectMap, "this is mapin listing");
      // Set flow state with project mapping stored in context
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_browse",
        step: 1,
        // context: {
        //   page,
        //   action: "list",
        //   totalPages,
        //   projectMap, // Store the entire project mapping
        // },
        text: "list_projects",
      });

      // Add pagination buttons if needed
      const buttons = [];
      if (page > 1) {
        buttons.push({
          type: "reply",
          reply: { id: `prev_page_${page - 1}`, title: "⬅️ Previous" },
        });
      }
      if (page < totalPages) {
        buttons.push({
          type: "reply",
          reply: { id: `next_page_${page + 1}`, title: "Next ➡️" },
        });
      }

      // Create list payload
      const listPayload = {
        to: `${phoneNumber}@s.whatsapp.net`,
        type: "list",
        header: { text: "Available Projects" },
        body: {
          text: `📋 *Your Projects* (Page ${page}/${totalPages})\n\nSelect a project to view or update:`,
        },
        footer: { text: "Powered by ShikshaLokam" },
        action: {
          list: {
            label: "View Projects",
            sections: [
              {
                title: "Projects",
                rows: listItems,
              },
            ],
          },
        },
      };

      await whatsappService.sendInteractiveMessage(listPayload);

      // Send pagination buttons separately if needed
      if (buttons.length > 0) {
        await whatsappService.sendInteractiveMessage({
          to: phoneNumber,
          type: "button",
          body: { text: "Navigate pages:" },
          action: { buttons },
        });
      }

      Logger.info("Listed projects", { phoneNumber, page, totalPages });
    } catch (error) {
      Logger.error("Error listing projects", error);
      throw error;
    }
  }

  /**
   * Handle project update flow
   */
  async handleProjectUpdateFlow(phoneNumber, messageText, lastMessage) {
    try {
      const step = lastMessage.step || 1;
      const context = lastMessage.context || {};

      Logger.info("Project update flow", { phoneNumber, step });

      // Add your project update logic here
      // Similar to creation flow but for updating existing projects
    } catch (error) {
      Logger.error("Error in project update flow", error);
      throw error;
    }
  }

  /**
   * Handle interactive responses (pagination, confirmations)
   */
  async handleInteractiveResponse(phoneNumber, action) {
    try {
      Logger.info("Handling interactive response", { phoneNumber, action });

      // Handle project confirmation
      if (action === "confirm_project") {
        const lastMessage = await usersQueries.getLastMessage(phoneNumber);
        const projectData = lastMessage.context;

        // TODO: Save project to database
        Logger.info("Saving project", { phoneNumber, projectData });

        await whatsappService.sendMessage(
          phoneNumber,
          "🎉 *Project created successfully!*\n\n" +
            `Project: ${projectData.projectName}\n\n` +
            "What would you like to do next?"
        );

        // Clear flow state
        await usersQueries.clearLastMessage(phoneNumber);
        return;
      }

      if (action === "cancel_project") {
        await usersQueries.clearLastMessage(phoneNumber);
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project creation cancelled."
        );
        return;
      }

      // Handle pagination
      if (/^next_page_(\d+)$/.test(action)) {
        const page = parseInt(action.match(/\d+/)[0]);
        await this.listProjects(phoneNumber, page);
        return;
      }

      if (/^prev_page_(\d+)$/.test(action)) {
        const page = parseInt(action.match(/\d+/)[0]);
        await this.listProjects(phoneNumber, page);
        return;
      }

      // Handle project selection
      if (/^project_(\d+)$/.test(action)) {
        const projectId = action.match(/\d+/)[0];
        Logger.info("Project selected", { phoneNumber, projectId });

        // TODO: Load project details and start update flow
        await whatsappService.sendMessage(
          phoneNumber,
          `📂 Loading project #${projectId}...`
        );
      }
    } catch (error) {
      Logger.error("Error handling interactive response", error);
      throw error;
    }
  }
}

module.exports = new ProjectService();

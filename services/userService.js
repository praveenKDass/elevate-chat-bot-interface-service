// ============================================
// FILE: services/userService.js
// ============================================
const axios = require("axios");
const config = require("../config/config");
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("../services/whatsappService");
const registrationFlow = require("../services/registrationFlow");
const startProjectMessage = require("../generics/interactiveMessages/startproject");

class UserService {
  constructor() {
    this.apiUrl = config.backend.apiUrl;
    this.apiKey = config.backend.apiKey;
  }

  /**
   * Get authorization headers
   * @private
   */
  getHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Check if user exists in backend
   * @param {string} phoneNumber - User's phone number
   * @returns {Promise<{success: boolean, data?: Object}>}
   */
  async checkUserExists(phoneNumber) {
    try {
      Logger.debug("Checking if user exists", { phoneNumber });

      const existingUsers = await usersQueries.usersDocuments({
        phoneNumber,
        status: "active",
      });

      if (existingUsers && existingUsers.length > 0) {
        Logger.debug("User exists", { phoneNumber });
        return { success: true, data: existingUsers[0] };
      } else {
        return { success: false };
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        Logger.debug("User not found", { phoneNumber });
        return { success: false };
      }
      Logger.error("Error checking user existence", error);
      throw error;
    }
  }

  /**
   * Create new user in backend
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @param {Object} additionalData - Additional user data
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  async createUser(phoneNumber, name, additionalData = {}) {
    try {
      Logger.info("Creating new user", { phoneNumber, name });

      let user = await usersQueries.findOne({ phoneNumber });

      // If user doesn't exist, create new record
      if (!user) {
        user = await usersQueries.create({
          phoneNumber,
          name,
          registrationProgress: "awaiting_registration_type",
          firstMessage: additionalData.firstMessage || "",
          firstMessageAt: new Date(),
          lastInteractionAt: new Date(),
          isRegistered: false,
          status: "active",
          ...additionalData,
        });

        Logger.info("New user record created", { phoneNumber, userId: user._id });
        return { success: true, data: user };
      }

      // User exists but not registered - return existing user
      if (user.registrationProgress !== "completed") {
        Logger.info("Returning existing incomplete user", { phoneNumber });
        return { success: true, data: user };
      }

      // User already registered
      Logger.info("User already registered", { phoneNumber });
      return { success: true, data: user };

    } catch (error) {
      Logger.error("Failed to create user", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Main authentication and message handler
   * This method contains ALL business logic for user authentication
   * @param {Object} message - WhatsApp message object
   * @returns {Promise<{success: boolean, handled: boolean}>}
   */
  async handleUserMessage(message) {
    try {
      const phoneNumber = message.from;
      const senderName = message.from_name || "User";
      const messageText = message.text?.body?.trim() || "";

      // Check if user exists
      const userCheck = await this.checkUserExists(phoneNumber);
      Logger.debug("User check result", { phoneNumber, exists: userCheck.success });

      // ================================
      // CASE 1️⃣: EXISTING & REGISTERED USER
      // ================================
      if (userCheck.success && userCheck.data?.isRegistered) {
        Logger.info("Existing registered user - showing main menu", {
          phoneNumber,
          userId: userCheck.data._id,
        });

        // Clear any active flow state before showing menu
        await usersQueries.clearLastMessage(phoneNumber);

        await whatsappService.sendInteractiveMessage({
          to: phoneNumber,
          ...startProjectMessage,
          body: {
            text: `Welcome back, ${senderName}! 👋\n\nPlease choose one of the following options:`,
          },
        });

        return {
          success: true,
          handled: true,
          userExists: true,
          isRegistered: true,
          user: userCheck.data,
        };
      }

      // ================================
      // CASE 2️⃣: USER EXISTS BUT NOT REGISTERED (RESUME REGISTRATION)
      // ================================
      if (userCheck.success && !userCheck.data?.isRegistered) {
        Logger.info("Resuming registration flow", {
          phoneNumber,
          progress: userCheck.data.registrationProgress,
        });

        // Set registration flow state
        await usersQueries.updateLastMessage(phoneNumber, {
          flow: "registration",
          step: 0,
          context: { userId: userCheck.data._id },
          text: messageText,
        });

        await registrationFlow.handle(
          userCheck.data,
          messageText,
          whatsappService.sendMessage
        );

        return {
          success: true,
          handled: true,
          userExists: true,
          isRegistered: false,
        };
      }

      // ================================
      // CASE 3️⃣: NEW USER - CONFIRMED LOGIN
      // ================================
      if (
        message.type === "interactive" &&
        message.interactive?.button_reply?.id === "YES_LOGIN"
      ) {
        Logger.info("New user confirmed login", { phoneNumber });

        // Create new user skeleton
        const newUser = await this.createUser(phoneNumber, senderName, {
          firstMessage: messageText,
          firstMessageAt: new Date().toISOString(),
          isRegistered: false,
          registrationProgress: "awaiting_registration_type",
          registrationData: {},
        });

        if (newUser.success) {
          await whatsappService.sendMessage(
            phoneNumber,
            `Great! Let's get you registered, ${senderName}! 🎉`
          );

          // Set registration flow state
          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "registration",
            step: 0,
            context: { userId: newUser.data._id },
            text: "YES_LOGIN",
          });

          // Start registration flow
          await registrationFlow.handle(
            newUser.data,
            messageText,
            whatsappService.sendMessage
          );

          Logger.info("New user registration started", {
            phoneNumber,
            userId: newUser.data._id,
          });

          return {
            success: true,
            handled: true,
            userExists: false,
            userCreated: true,
            isRegistered: false,
            user: newUser.data,
          };
        } else {
          await whatsappService.sendMessage(
            phoneNumber,
            "❌ Sorry, we encountered an error creating your account. Please try again later."
          );

          Logger.error("User creation failed", {
            phoneNumber,
            error: newUser.error,
          });

          return {
            success: false,
            handled: true,
            error: newUser.error,
          };
        }
      }

      // ================================
      // CASE 4️⃣: NEW USER - DECLINED LOGIN
      // ================================
      if (
        message.type === "interactive" &&
        message.interactive?.button_reply?.id === "NO_LOGIN"
      ) {
        Logger.info("User declined login - re-prompting", { phoneNumber });

        await whatsappService.sendInteractiveMessage({
          to: phoneNumber,
          type: "button",
          body: {
            text: `No problem! 👋\n\nWhenever you're ready, just click "Yes" to get started with Shikshalokam.`,
          },
          action: {
            buttons: [
              {
                type: "reply",
                reply: { id: "YES_LOGIN", title: "✅ Yes, Sign Me Up" },
              },
              {
                type: "reply",
                reply: { id: "NO_LOGIN", title: "❌ Not Now" },
              },
            ],
          },
        });

        return {
          success: true,
          handled: true,
          loginDeclined: true,
        };
      }

      // ================================
      // CASE 5️⃣: NEW USER - FIRST MESSAGE (ASK TO LOGIN)
      // ================================
      Logger.info("New user - prompting login", { phoneNumber });

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: `Welcome to Shikshalokam! 👋\n\nHi ${senderName}, I'm here to help you manage your projects and more.\n\nWould you like to get started?`,
        },
        action: {
          buttons: [
            { 
              type: "reply", 
              reply: { id: "YES_LOGIN", title: "✅ Yes, Let's Start!" } 
            },
            { 
              type: "reply", 
              reply: { id: "NO_LOGIN", title: "❌ Not Now" } 
            },
          ],
        },
      });

      return {
        success: true,
        handled: true,
        promptedLogin: true,
      };

    } catch (error) {
      Logger.error("Error in handleUserMessage", error);

      try {
        await whatsappService.sendMessage(
          message.from,
          "❌ Sorry, something went wrong. Please try again."
        );
      } catch (sendError) {
        Logger.error("Failed to send error message", sendError);
      }

      return {
        success: false,
        handled: true,
        error: error.message,
      };
    }
  }

  /**
   * Get user by phone number
   * @param {string} phoneNumber - User's phone number
   * @returns {Promise<Object|null>}
   */
  async getUserByPhone(phoneNumber) {
    try {
      const user = await usersQueries.findOne({ phoneNumber });
      return user;
    } catch (error) {
      Logger.error("Error fetching user", error);
      throw error;
    }
  }

  /**
   * Update user information
   * @param {string} phoneNumber - User's phone number
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>}
   */
  async updateUser(phoneNumber, updateData) {
    try {
      Logger.info("Updating user", { phoneNumber });

      const updatedUser = await usersQueries.update(
        { phoneNumber },
        { $set: updateData },
        { new: true }
      );

      Logger.info("User updated successfully", { phoneNumber });
      return updatedUser;
    } catch (error) {
      Logger.error("Failed to update user", error);
      throw error;
    }
  }
}

module.exports = new UserService();
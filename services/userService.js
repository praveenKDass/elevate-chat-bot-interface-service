// ============================================
// FILE: services/userService.js
// ============================================
const axios = require('axios');
const config = require('../config/config');
const Logger = require('../utils/logger');
const usersQueries  = require('../database/databaseQueries/userQueries');

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
      'Content-Type': 'application/json'
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }

  /**
   * Check if user exists in backend
   * @param {string} phoneNumber - User's phone number
   * @returns {Promise<boolean>}
   */
  async checkUserExists(phoneNumber) {
    try {
      Logger.debug('Checking if user exists', { phoneNumber });

      const existingUsers = await usersQueries.usersDocuments({ phoneNumber ,status: 'active' });
     console.log(existingUsers ,"49");
      if (existingUsers && existingUsers.data) {
        Logger.debug('User exists', { phoneNumber });
        return {sucess:true};
      }else{
        return {sucess:false};
      }

    } catch (error) {
      if (error.response && error.response.status === 404) {
        Logger.debug('User not found', { phoneNumber });
        return {sucess:false}
      }
      Logger.error('Error checking user existence', error);
      throw error;
    }
  }

  /**
   * Create new user in backend
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @param {Object} additionalData - Additional user data
   * @returns {Promise<Object>}
   */
  async createUser(phoneNumber, name, additionalData = {}) {
    try {
      Logger.info('Creating new user', { phoneNumber, name });

      const userData = {
        phoneNumber,
        name,
        source: 'whatsapp',
        createdAt: new Date().toISOString(),
        ...additionalData
      };

      const response = await axios.post(
        `${this.apiUrl}/users`,
        userData,
        { headers: this.getHeaders() }
      );

      Logger.info('User created successfully', { userId: response.data.id });
      return response.data;
    } catch (error) {
      Logger.error('Failed to create user', error);
      throw new Error(`User creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get user by phone number
   * @param {string} phoneNumber - User's phone number
   * @returns {Promise<Object|null>}
   */
  async getUserByPhone(phoneNumber) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/users/${phoneNumber}`,
        { headers: this.getHeaders() }
      );
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return null;
      }
      Logger.error('Error fetching user', error);
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
      Logger.info('Updating user', { phoneNumber });

      const response = await axios.patch(
        `${this.apiUrl}/users/${phoneNumber}`,
        updateData,
        { headers: this.getHeaders() }
      );

      Logger.info('User updated successfully', { phoneNumber });
      return response.data;
    } catch (error) {
      Logger.error('Failed to update user', error);
      throw error;
    }
  }
}

module.exports = new UserService();

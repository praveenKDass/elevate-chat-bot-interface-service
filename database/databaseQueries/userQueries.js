const database= require('../../config/db');


module.exports = class users {

    /**
     * find userss
     * @method
     * @name usersDocuments
     * @param {Array} [usersFilter = "all"] - users ids.
     * @param {Array} [fieldsArray = "all"] - projected fields.
     * @param {Array} [sortedData = "all"] - sorted field.
     * @param {Array} [skipFields = "none"] - field not to include
     * @returns {Array} List of users documents.
     */
  
    static usersDocuments(
      usersFilter = 'all',
      fieldsArray = 'all',
      sortedData = 'all',
      skipFields = 'none'
    ) {
      return new Promise(async (resolve, reject) => {
        try {
          let queryObject = usersFilter != 'all' ? usersFilter : {};
  
          let projection = {};
  
          if (fieldsArray != 'all') {
            fieldsArray.forEach((field) => {
              projection[field] = 1;
            });
          }
  
          if (skipFields !== 'none') {
            skipFields.forEach((field) => {
              projection[field] = 0;
            });
          }
  
          let usersDocuments;
  
          if (sortedData !== 'all') {
            usersDocuments = await database.models.users
              .find(queryObject, projection)
              .sort(sortedData)
              .lean();
          } else {
            usersDocuments = await database.models.user.find(queryObject, projection).lean();
          }
  
          return resolve(usersDocuments);
        } catch (error) {
          return resolve({
            success: false,
            message: error.message,
            data: false,
          });
        }
      });
    }
  
   /**
     * Update users
     * @method
     * @name updateMany
     * @param {Object} query 
     * @param {Object} update 
     * @returns {JSON} - update response
    */
  
    static updateMany(query, update) {
      return new Promise(async (resolve, reject) => {
        try {
          let usersDocuments = await database.models.user.updateMany(query, update);
          return resolve(usersDocuments);
        } catch (error) {
          return reject(error);
        }
      });
    }
  
     /**
     * Update users
     * @method
     * @name update
     * @param {Object} query 
     * @param {Object} updateObject 
     * @param {Object} returnData 
     * @returns {JSON} - update response
    */
  
     static update(query, updateObject,returnData = { new: false }) {
      return new Promise(async (resolve, reject) => {
        try {
          let usersDocuments = await database.models.user.findOneAndUpdate(query, updateObject, returnData).lean();;
          return resolve(usersDocuments);
        } catch (error) {
          return reject(error);
        }
      });
    }
  
     /**
     * create users
     * @method
     * @name create
     * @param {Object} usersData - users data.
     * @returns {Object} users object.
     */
     static create(usersData) {
      return new Promise(async (resolve, reject) => {
        try {
          let usersDocument = await database.models.user.create(usersData);
          return resolve(usersDocument);
        } catch (error) {
          return reject(error);
        }
      });
    }
  
  
  }
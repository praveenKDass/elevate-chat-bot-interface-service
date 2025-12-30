const axios = require("axios");

/**
 * Generic function for making API calls
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - API endpoint
 * @param {object} headers - Request headers
 * @param {object} body - Request payload (for POST/PUT)
 * @returns {Promise<object>}
 */

async function makeApiRequest(method, url, token, body = {}) {
  try {
    console.log(method,url, "this is token");
    const headers = {
      "Content-Type": "application/json",
      "x-auth-token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlkIjoyODU1LCJuYW1lIjoic2dmdW5jdGlvbmFyaWVzIHNnb2ZmaWNpYWwiLCJzZXNzaW9uX2lkIjoyOTIwOSwib3JnYW5pemF0aW9uX2lkcyI6WyIzOSJdLCJvcmdhbml6YXRpb25fY29kZXMiOlsidHJpcHVyYSJdLCJ0ZW5hbnRfY29kZSI6InNoaWtzaGFncmFoYW5ldyIsIm9yZ2FuaXphdGlvbnMiOlt7ImlkIjozOSwibmFtZSI6IlRyaXB1cmEiLCJjb2RlIjoidHJpcHVyYSIsImRlc2NyaXB0aW9uIjoidHJpcHVyYSBzdGF0ZSBhcyBhbiBvcmdhbml6YXRpb24gdGVzdCBpbiBTRyIsInN0YXR1cyI6IkFDVElWRSIsInJlbGF0ZWRfb3JncyI6W10sInRlbmFudF9jb2RlIjoic2hpa3NoYWdyYWhhbmV3IiwibWV0YSI6bnVsbCwiY3JlYXRlZF9ieSI6MSwidXBkYXRlZF9ieSI6Mzc3LCJyb2xlcyI6W3siaWQiOjc3LCJ0aXRsZSI6Im1lbnRlZSIsImxhYmVsIjoibWVudGVlIiwidXNlcl90eXBlIjowLCJzdGF0dXMiOiJBQ1RJVkUiLCJvcmdhbml6YXRpb25faWQiOjM1LCJ2aXNpYmlsaXR5IjoiUFVCTElDIiwidGVuYW50X2NvZGUiOiJzaGlrc2hhZ3JhaGFuZXciLCJ0cmFuc2xhdGlvbnMiOm51bGx9XX1dfSwiaWF0IjoxNzY3MDgwNDkxLCJleHAiOjE3NjcxNjY4OTF9.SwJOo0LDPFKoUJcMw9EqyDKNYflxrdDjcxUveEA4LjM",
    };

    if(method.toUpperCase() == "GET"){
      headers["x-app-ver"]=""
    }

    const options = {
      method,
      url,
      headers,
    };

    if (method.toUpperCase() !== "GET") {
      options.data = body;
    }

    console.log("Request Options:", JSON.stringify(options, null, 2));
    
    const response = await axios(options);

    console.log("Response:", response.data);

    return {
      success: true,
      data: response.data,
      status: response.status,
    };
  } catch (error) {
    console.error(
      `API request failed [${method}] ${url}`,
      error.response?.data || error.message
    );
    return {
      success: false,
      status: error.response?.status || 500,
      error: error.response?.data || error.message,
    };
  }
}

async function downloadBinaryFile(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return {
      success: true,
      data: response.data,
      status: response.status,
    };
  } catch (error) {
    return {
      success: false,
      status: error.response?.status || 500,
      error: error.response?.data || error.message,
    };
  }
}

module.exports = { makeApiRequest, downloadBinaryFile };

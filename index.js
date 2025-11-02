const express = require('express');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

const app = express();
app.use(express.json());

// Configuration
const WHAPI_TOKEN = process.env.WHAPI_TOKEN; // Your Whapi Cloud token
const WHAPI_CHANNEL = process.env.WHAPI_CHANNEL || 'default'; // Your channel ID
const WHAPI_BASE_URL = 'https://gate.whapi.cloud';
const YOUR_BACKEND_API = process.env.BACKEND_API_URL; // Your backend service URL
const PORT = process.env.PORT || 3000;

// Validate required environment variables
if (!WHAPI_TOKEN) {
  console.error('ERROR: WHAPI_TOKEN is not set in environment variables!');
  process.exit(1);
}

// Store processed message IDs to avoid duplicate processing
const processedMessages = new Set();

// Webhook endpoint to receive WhatsApp messages
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    // Acknowledge receipt immediately
    res.status(200).send('OK');

    const { messages } = req.body;
    
    if (!messages || messages.length === 0) {
      return;
    }

    // Process each message
    for (const message of messages) {
      // Avoid processing the same message twice
      if (processedMessages.has(message.id)) {
        continue;
      }
      processedMessages.add(message.id);

      // Clean up old message IDs (keep last 1000)
      if (processedMessages.size > 1000) {
        const firstId = processedMessages.values().next().value;
        processedMessages.delete(firstId);
      }

      // Skip if message is from yourself or is not incoming
      if (!message.from_me && message.from) {
        await handleIncomingMessage(message);
      }
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
  }
});

// Handle incoming WhatsApp message
async function handleIncomingMessage(message) {
  try {
    const phoneNumber = message.from; // sender's phone number
    const messageText = message.text?.body || '';
    const senderName = message.from_name || 'User';

    console.log(`Received message from ${phoneNumber}: ${messageText}`);
    // Send welcome message
    await sendWhatsAppMessage(phoneNumber, 
        `Welcome ${senderName}! 👋\n\n. How can I help you today?`
      );
    // Check if user exists in your backend
    const userExists = await checkUserExists(phoneNumber);

    if (!userExists) {
      // Create user in your backend
      console.log(`Creating new user for ${phoneNumber}`);
      await createUser(phoneNumber, senderName);
      
      // Send welcome message
      await sendWhatsAppMessage(phoneNumber, 
        `Welcome ${senderName}! 👋\n\nYour account has been created successfully. How can I help you today?`
      );
    } else {
      // User exists, process the message normally
      console.log(`User ${phoneNumber} already exists`);
      
      // Send acknowledgment or process the message
      await sendWhatsAppMessage(phoneNumber, 
        `Hi ${senderName}! I received your message: "${messageText}"\n\nHow can I assist you?`
      );
    }

  } catch (error) {
    console.error('Error handling message:', error);
  }
}

// Check if user exists in your backend
async function checkUserExists(phoneNumber) {
  try {
    const response = await axios.get(`${YOUR_BACKEND_API}/users/${phoneNumber}`, {
      headers: {
        'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`, // if needed
        'Content-Type': 'application/json'
      }
    });
    
    return response.status === 200 && response.data;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return false; // User doesn't exist
    }
    console.error('Error checking user:', error.message);
    throw error;
  }
}

// Create user in your backend
async function createUser(phoneNumber, name) {
  try {
    const response = await axios.post(`${YOUR_BACKEND_API}/users`, {
      phoneNumber: phoneNumber,
      name: name,
      source: 'whatsapp',
      createdAt: new Date().toISOString()
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.BACKEND_API_KEY}`, // if needed
        'Content-Type': 'application/json'
      }
    });
    
    console.log('User created successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error creating user:', error.message);
    throw error;
  }
}

// Send WhatsApp message using Whapi Cloud
async function sendWhatsAppMessage(to, text) {
  try {
    // Whapi Cloud requires channel-specific endpoint
    const url = `${WHAPI_BASE_URL}/messages/text`;
    
    console.log(`Sending message to ${to}...`);
    
    const response = await axios.post(
      url,
      {
        to: to,
        body: text
      },
      {
        headers: {
          'Authorization': `Bearer ${WHAPI_TOKEN}`,
          'Content-Type': 'application/json'
        },
        params: {
          channel: WHAPI_CHANNEL // Add channel parameter
        }
      }
    );
    
    console.log('Message sent successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending message:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('URL:', error.config?.url);
    throw error;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`WhatsApp service running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/whatsapp`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;
// ============================================
// FILE: routes/webhookRoutes.js
// ============================================
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const validateWebhook = require('../middleware/validateWebhook');

// Webhook endpoint
// router.post('/whatsapp', validateWebhook, webhookController.handleWebhook.bind(webhookController));

// Health check
// router.get('/health', webhookController.healthCheck.bind(webhookController));

router.get('/whatsapp', webhookController.verifyWebhook.bind(webhookController));
router.post('/whatsapp', validateWebhook, webhookController.handleWebhook.bind(webhookController));
// Test connection
router.get('/test-connection', webhookController.testConnection.bind(webhookController));

module.exports = router;
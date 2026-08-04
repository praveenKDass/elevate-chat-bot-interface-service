// // ============================================
// // FILE: middleware/validateWebhook.js
// // ============================================
// const config = require('../config/config');
// const Logger = require('../utils/logger');

// /**
//  * Validate webhook authenticity (optional)
//  */
// const validateWebhook = (req, res, next) => {
//   // If webhook secret is configured, validate it
//   if (config.webhook.secret) {
//     const signature = req.headers['x-webhook-signature'];
    
//     if (!signature || signature !== config.webhook.secret) {
//       Logger.warn('Invalid webhook signature', { ip: req.ip });
//       return res.status(401).json({ error: 'Unauthorized' });
//     }
//   }

//   next();
// };

// module.exports = validateWebhook;

// ============================================
// FILE: middleware/validateWebhook.js
// ============================================
const config = require('../config/config');
const whatsappService = require('../services/whatsappService');
const Logger = require('../utils/logger');

/**
 * Validate webhook authenticity per active provider.
 *  - whapi: optional shared-secret header check (existing behavior, preserved)
 *  - meta:  required HMAC-SHA256 signature check against raw body
 */
const validateWebhook = (req, res, next) => {
  const provider = config.whatsappProvider;

  if (provider === 'meta') {
    // Meta requires this — not optional, since anyone can hit a public URL otherwise
    if (!whatsappService.verifySignature(req)) {
      Logger.warn('Invalid Meta webhook signature', { ip: req.ip });
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  }

  // whapi (default) — preserve existing optional shared-secret behavior
  if (config.webhook.secret) {
    const signature = req.headers['x-webhook-signature'];

    if (!signature || signature !== config.webhook.secret) {
      Logger.warn('Invalid webhook signature', { ip: req.ip });
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  next();
};

module.exports = validateWebhook;
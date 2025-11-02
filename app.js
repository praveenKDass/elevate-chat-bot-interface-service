const express = require('express');
const webhookRoutes = require('./routes/webhookRoutes');
const errorHandler = require('./middleware/errorHandler');
const Logger = require('./utils/logger');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  Logger.debug(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.body
  });
  next();
});

// Routes
app.use('/webhook', webhookRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'WhatsApp Webhook Service',
    status: 'running',
    version: '1.0.0'
  });
});

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
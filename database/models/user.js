const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * User Data Schema
 * Following ELEVATE project pattern
 */
const usersSchema = new Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  password: {
    type: String,
    required: true,
    select: false
  },
  
  files: {
    type:Array,
    default: []
  },
  
  lastMessage: {
    type: String
  },

  scope: {
    type: Object,
    default: {}
  },
  
  source: {
    type: String,
    default: 'whatsapp',
    enum: ['whatsapp', 'api', 'manual']
  },
  
  status: {
    type: String,
    default: 'active',
    enum: ['active', 'inactive', 'blocked']
  },
  
  firstMessage: {
    type: String,
    default: ''
  },
  
  firstMessageAt: {
    type: Date
  },
  
  lastInteractionAt: {
    type: Date,
    default: Date.now
  },
  
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'users'
});

// Indexes
usersSchema.index({ phoneNumber: 1 });
usersSchema.index({ status: 1 });
usersSchema.index({ createdAt: -1 });

// Pre-save hook to update updatedAt
usersSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('users', usersSchema);

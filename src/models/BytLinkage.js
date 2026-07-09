const mongoose = require('mongoose');

const BytLinkageSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    unique: true
  },
  count: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  cnldCount: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  tehsCount: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('BytLinkage', BytLinkageSchema);

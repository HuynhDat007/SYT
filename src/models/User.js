const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'unit'],
    default: 'unit'
  },
  unitName: {
    type: String,
    required: true
  },
  contactName: {
    type: String,
    default: ''
  },
  contactPhone: {
    type: String,
    default: ''
  },
  contactEmail: {
    type: String,
    default: ''
  },
  planTarget: {
    type: Number,
    default: 0
  },
  residentPopulation: {
    type: Number,
    default: 0
  },
  firstHalfChecked: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', UserSchema);

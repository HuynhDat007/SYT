const mongoose = require('mongoose');

const HealthCenterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index to ensure health center names are unique within a single unit
HealthCenterSchema.index({ name: 1, unitId: 1 }, { unique: true });

module.exports = mongoose.model('HealthCenter', HealthCenterSchema);

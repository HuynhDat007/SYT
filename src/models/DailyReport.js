const mongoose = require('mongoose');

const DailyReportSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  unitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  centerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HealthCenter',
    required: false
  },
  under6: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  from6To18: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  over18: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  adminUnder6: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  adminFrom6To18: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  adminOver18: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  adminWorkplace: {
    type: String,
    default: ''
  },
  adminIsPolitical: {
    type: Boolean,
    default: false
  },
  adminIncludeInTotal: {
    type: Boolean,
    default: false
  },
  adminWorkers: {
    type: Number,
    min: 0,
    default: 0
  },
  adminChildren: {
    type: Number,
    min: 0,
    default: 0
  },
  adminPolitical: {
    type: Number,
    min: 0,
    default: 0
  },
  adminOthers: {
    type: Number,
    min: 0,
    default: 0
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['commune', 'admin_general', 'workplace', 'political'],
    default: 'commune'
  }
}, {
  timestamps: true
});

// Non-unique composite index to allow multiple workplace reports per health center per day
DailyReportSchema.index({ date: 1, centerId: 1 });
// Index for quick queries of all data for a unit
DailyReportSchema.index({ date: 1, unitId: 1 });
// Index for type-based query speed
DailyReportSchema.index({ date: 1, centerId: 1, type: 1 });

module.exports = mongoose.model('DailyReport', DailyReportSchema);

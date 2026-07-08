require('dotenv').config();
const mongoose = require('mongoose');
const AuditLog = require('./src/models/AuditLog');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(10);
    console.log('Audit logs:', JSON.stringify(logs, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();

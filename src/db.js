const mongoose = require('mongoose');
const dns = require('dns');

// On Windows, c-ares may query IPv6 DNS servers first and fail SRV resolution with ESERVFAIL.
// Filter to active IPv4 DNS servers if available.
try {
  const currentServers = dns.getServers();
  const ipv4Servers = currentServers.filter(s => !s.includes(':'));
  if (ipv4Servers.length > 0) {
    dns.setServers(ipv4Servers);
  }
} catch (e) {
  // Ignore DNS config errors
}

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not defined in the environment variables.');
    }
    
    // Connect to MongoDB Atlas
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    // Database connection active
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;

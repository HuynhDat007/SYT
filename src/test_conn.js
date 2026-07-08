require('dotenv').config();
const mongoose = require('mongoose');

const mongoUri = process.env.MONGODB_URI;
console.log('Attempting to connect to MongoDB:', mongoUri.replace(/:[^:]+@/, ':****@'));

mongoose.connect(mongoUri)
  .then(() => {
    console.log('MongoDB Atlas connection SUCCESS!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('MongoDB Atlas connection FAILED:', err);
    process.exit(1);
  });

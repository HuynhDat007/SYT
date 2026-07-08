FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definition
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Start command
CMD ["npm", "start"]

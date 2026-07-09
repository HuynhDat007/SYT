FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definition with appropriate ownership
COPY --chown=node:node package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application code with appropriate ownership
COPY --chown=node:node . .

# Set environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Set user to node
USER node

# Start command
CMD ["npm", "start"]

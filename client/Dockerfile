# Build stage
FROM node:18-alpine as build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy built files
COPY --from=build /app/dist ./dist

# Copy server file
COPY server.js .

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "server.js"]

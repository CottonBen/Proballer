# Proballers Coaching Finland — production container
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Persist the SQLite database + invoices outside the image
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server/app.js"]

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY index.html server.js ./

EXPOSE 3000
CMD ["node", "server.js"]

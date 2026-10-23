FROM node:22-alpine

ENV NODE_ENV=production
ENV DATA_DIR=/data
WORKDIR /app

COPY package.json ./
COPY index.html server.js ./

VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install edge-tts

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p output temp data tokens assets

EXPOSE 3001

CMD ["node", "server.js"]

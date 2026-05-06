FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 7860

CMD ["bash","-lc","set -euo pipefail; trap 'kill 0' TERM INT; node server.js & node headless.js & wait -n; kill 0; wait"]

# ---------- Build (compila TypeScript) ----------
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Se seu projeto usa "npm run build" para gerar /dist:
RUN npm run build

# ---------- Runtime (roda a app compilada) ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Se você precisa de migrations em runtime (SQL puros), descomente a linha abaixo e ajuste o path:
# COPY --from=builder /app/migrations ./migrations

# A porta interna padrão do app (ajuste se diferente)
EXPOSE 3000

# O start deve rodar o JS compilado (dist). Ex.: "node dist/index.js"
# Certifique-se de que seu package.json tem: "start": "node dist/index.js"
CMD ["npm","start"]
# Etapa base
FROM node:20-bullseye

# Configura diretório de trabalho
WORKDIR /app

# Copia arquivos de dependências
COPY package.json package-lock.json* yarn.lock* ./

# Instala dependências
RUN npm install -g expo-cli && npm install

# Copia o restante do código
COPY . .

# Expo usa a porta 19000 (Metro bundler), 19001 (LAN), 19002 (devtools), 8081
EXPOSE 19000 19001 19002 8081

# Comando padrão: iniciar o Expo
CMD ["npx", "expo", "start", "--tunnel", "--clear"]

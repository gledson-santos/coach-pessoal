# Guia de aplicação completa (backend + front)

Este passo a passo cobre todo o fluxo para colocar o backend Node/Express e o front-end Expo React Native do Coach Pessoal para rodar em ambiente local e preparar builds de testes.

## 1. Pré-requisitos

- **Node.js 18 ou superior** (recomendado instalar via [nvm](https://github.com/nvm-sh/nvm)).
- **npm** (já incluso nas instalações oficiais do Node).
- **MySQL 8+** (local ou hospedado).
- **Expo CLI** (`npm install -g expo-cli`) opcionalmente, para facilitar alguns comandos no front.
- **Conta Expo/EAS** (necessária apenas para gerar builds com `eas build`).

## 2. Clonar o projeto

```bash
git clone git@github.com:SEU_ORG/coach-pessoal.git
cd coach-pessoal
```

## 3. Configuração do backend (`/back`)

1. **Instalar dependências**
   ```bash
   cd back
   npm install
   ```

2. **Configurar variáveis de ambiente**
   - Use o arquivo de exemplo e ajuste com suas credenciais:
     ```bash
     cp .env.example .env
     ```
   - Atualize as chaves OAuth do Google e Microsoft, além das credenciais do MySQL. Os nomes das variáveis estão descritos no próprio `.env.example` e em [`back/README.md`](../back/README.md).

3. **Preparar o banco de dados**
   - Crie o schema informado em `DB_NAME` (padrão `coach`).
   - Rode a migration inicial para criar as tabelas:
     ```bash
     mysql -u <usuario> -p<senha> <database> < migrations/001_init.sql
     ```
     > Substitua `<usuario>`, `<senha>` e `<database>` pelos valores configurados no `.env`.

4. **Executar em modo desenvolvimento**
   ```bash
   npm run dev
   ```
   - A API sobe por padrão em `http://localhost:4001/health`.

5. *(Opcional)* **Build e execução em produção**
   ```bash
   npm run build
   npm start
   ```

## 4. Configuração do front (`/front`)

1. **Instalar dependências**
   ```bash
   cd ../front
   npm install
   ```

2. **Apontar o front para o backend**
   - Durante o desenvolvimento local, o app usa `http://localhost:4001` por padrão (`front/src/config/api.ts`).
   - Para apontar para outro endpoint (por exemplo, quando o backend roda em outra máquina), defina a variável `EXPO_PUBLIC_API_BASE_URL`:
     ```bash
     EXPO_PUBLIC_API_BASE_URL="http://192.168.0.10:4001" npm run start
     ```

3. **Configurar credenciais OAuth no app**
   - Caso use IDs diferentes dos padrões, exporte-os como variáveis `EXPO_PUBLIC_GOOGLE_*` e `EXPO_PUBLIC_MICROSOFT_*` antes de rodar o Expo. Exemplo:
     ```bash
     EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID=<client-id-expo> \
     EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<client-id-android> \
     EXPO_PUBLIC_MICROSOFT_CLIENT_ID=<client-id-msal> \
     EXPO_PUBLIC_MICROSOFT_DEFAULT_TENANT=consumers \
     npm run start
     ```
   - Esses valores são lidos nos arquivos de configuração em `front/src/config/`.

4. **Executar o app**
   ```bash
   npm run start
   ```
   - Abra o app Expo Go no dispositivo ou use os atalhos `npm run android`, `npm run ios` ou `npm run web` conforme necessário.

5. *(Opcional)* **Gerar build Android**
   - Siga o guia detalhado em [`front/docs/android-build.md`](../front/docs/android-build.md) para criar APK/AAB via EAS.

## 5. Fluxo sugerido no dia a dia

1. Inicie o backend (passo 3.4) para garantir que os endpoints OAuth e sincronização de calendários estejam disponíveis.
2. No front, rode `npm run start` ou o comando específico da plataforma desejada.
3. Teste a autenticação Google/Microsoft e os fluxos de agenda. Em caso de erros de OAuth, confirme se as URLs de redirecionamento configuradas no `.env` e nas variáveis `EXPO_PUBLIC_*` batem com os endpoints usados pelo Expo (por exemplo, `http://localhost:19006/` ou `https://auth.expo.dev/...`).

Com esses passos você consegue aplicar e validar o backend e o front localmente, além de preparar builds para distribuição de testes.

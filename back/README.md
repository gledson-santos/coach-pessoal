# Coach Backend

Backend em Node/Express responsável pela troca de códigos OAuth e pelo cadastro das contas de calendário utilizadas no Coach Pessoal.

## Requisitos

- Node.js >= 18
- MySQL 8+
- npm (ou yarn)

## Configuração

1. Instale as dependências:

`
npm install
`

2. Copie o arquivo de exemplo de variáveis de ambiente e ajuste os valores conforme o seu ambiente:

`
cp .env.example .env
`

Variáveis relevantes:

- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME: credenciais da base MySQL.
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URIS: credenciais do app Google.
- MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URIS, MICROSOFT_TENANT_ID: credenciais do app Microsoft. Por padrão usamos o tenant `consumers`, voltado para contas pessoais (Outlook.com, Hotmail, Live, etc.).
- MICROSOFT_SCOPES: escopos adicionais para o login Microsoft (por padrão solicitamos permissões delegadas como `Calendars.Read`).
- MICROSOFT_ORGANIZATIONS_TENANT: tenant usado para contas corporativas (padrão `organizations`).
- MICROSOFT_ALLOWED_TENANTS: lista (separada por vírgula) de tenants permitidos para autenticação. Caso não seja informado, permitimos automaticamente o tenant pessoal (`consumers`) e o corporativo configurado.

3. Crie as tabelas necessárias executando as migrations (ajuste o usuário/senha conforme o seu ambiente):

`
mysql -u root -p coach < migrations/001_init.sql
`

Migrations disponíveis:

- 001_init.sql: estrutura inicial de contas e tokens.
- 002_add_ics_calendar.sql: suporte a contas ICS.
- 003_create_app_events.sql: armazenamento de eventos sincronizados do app.
- 004_add_integration_date_to_app_events.sql: marcação de integração pendente/concluída nos eventos.

Se desejar trabalhar com outro banco, altere a variável DB_NAME no .env e no comando acima.

## Scripts úteis

- 
pm run dev: inicia a API em modo desenvolvimento com recarga automática.
- 
pm run build: compila o TypeScript para JavaScript em dist/.
- 
pm start: executa a versão compilada.

## Endpoints

### GET /health
Retorna um payload simples indicando que a API está de pé.

### GET /oauth/config
Fornece os dados públicos necessários para iniciar o fluxo OAuth no front-end (client IDs, tenants e escopos).

### POST /oauth/google/exchange
Recebe um uthorization_code do Google, troca por tokens e registra/atualiza a conta de calendário no banco.

Corpo esperado (exemplo):

`
{
  "code": "...",
  "redirectUri": "http://localhost:8081/",
  "color": "#2a9d8f"
}
`

Resposta (resumo):

`
{
  "account": {
    "id": "...",
    "provider": "google",
    "email": "...",
    "color": "#2a9d8f"
  },
  "tokens": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresIn": 3600
  }
}
`

### POST /oauth/outlook/exchange
Fluxo idêntico ao do Google, porém usando o endpoint da Microsoft com permissões delegadas (Authorization Code Flow). Aceita parâmetros opcionais como tenantId, scopes e color.

### GET /accounts
Lista todas as contas de calendário cadastradas no banco.

### PATCH /accounts/:id/color
Atualiza a cor associada à conta.

### PATCH /accounts/:id/tokens
Atualiza os tokens armazenados de uma conta (access token, refresh token, expiração e metadados).

### POST /accounts/:id/refresh
Renova o access token usando o refresh token persistido para contas Google ou Outlook.

### DELETE /accounts/:id
Remove a conta e os tokens persistidos.

### POST /accounts/ics
Registra uma conta do tipo ICS a partir de um link público (webcal/http/https) e retorna os dados da conta criada.

### POST /ics/fetch
Baixa o conteúdo bruto de um link ICS e devolve o calendário como text/calendar.

### POST /sync/events
Recebe eventos do app, persiste/atualiza e devolve alterações desde a última sincronização (baseado em updatedAt).

### GET /integration/events
Lista eventos pendentes de integração (integration_date nulo) com paginação.

### POST /integration/events/mark
Marca uma lista de eventos como integrados (define integration_date) ou desfaz a integração informando null.

## Estrutura de Persistência

- src/db.ts expõe um pool de conexões MySQL (mysql2/promise).
- src/repositories/calendarAccountRepository.ts centraliza as operações de CRUD dos cadastros de contas.
- src/repositories/appEventRepository.ts gerencia a tabela app_events com sincronização, marcação e listagem de pendências.
- As migrations SQL estão em migrations/.
- O fluxo de integração pendente usa a coluna integration_date em app_events: eventos com valor nulo são expostos em /integration/events e marcados via /integration/events/mark.

Com isso a API deixa de manter tokens apenas em memória e passa a usar MySQL como armazenamento primário, permitindo múltiplas contas por provedor.

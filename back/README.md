# Coach Backend

Backend em Node/Express responsável por autenticação multi-tenant, troca de códigos OAuth, e cadastro das contas de calendário utilizadas no Coach Pessoal.

## Requisitos

- Node.js >= 18
- MySQL 8+
- npm (ou yarn)

## Configuração

1. Instale as dependências:

```
npm install
```

2. Configure as variáveis de ambiente (exemplo abaixo):

```
PORT=4000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=coach

# Auth
AUTH_JWT_SECRET=troque-este-segredo
# 32 bytes em base64 (ex: openssl rand -base64 32)
AUTH_ENCRYPTION_KEY=
AUTH_ACCESS_TTL=900
AUTH_REFRESH_TTL_DAYS=30
AUTH_RESET_TTL_MINUTES=60
```

> **Importante:** `AUTH_ENCRYPTION_KEY` é obrigatório para criptografar secrets OAuth dos tenants.

3. Crie as tabelas necessárias executando as migrations (ajuste o usuário/senha conforme o seu ambiente):

```
mysql -u root -p coach < migrations/001_init.sql
mysql -u root -p coach < migrations/002_add_ics_calendar.sql
mysql -u root -p coach < migrations/003_create_app_events.sql
mysql -u root -p coach < migrations/004_add_integration_date_to_app_events.sql
mysql -u root -p coach < migrations/005_auth_multi_tenant.sql
```

## Multi-tenant

- O tenant é identificado pelo header **`X-Tenant-ID`** em todas as rotas de autenticação e configurações.
- O fluxo OAuth social usa **state** armazenado no banco com tenant e expiração, evitando spoofing.
- Nenhum dado de usuário/configuração é retornado fora do tenant solicitado.

## Como criar tenant e admin inicial

```
POST /tenants
{
  "name": "Minha Empresa",
  "adminEmail": "admin@empresa.com",
  "adminPassword": "Senha@123"
}
```

A resposta contém o `tenantId` e o `adminUserId`.

## Configurando OAuth por tenant

Cada tenant configura suas credenciais via:

```
PUT /tenant/oauth/:provider
Headers: X-Tenant-ID + Authorization: Bearer <accessToken>
Body:
{
  "clientId": "...",
  "clientSecret": "...",
  "callbackUri": "https://sua-api.com/auth/oauth/google/callback",
  "redirectUris": ["coachpessoal://oauth"]
}
```

**Provedores suportados:** `google`, `microsoft`, `facebook`.

- `callbackUri` deve ser cadastrado no console do provedor (callback do backend).
- `redirectUris` são os deep links do app para finalizar o login (receber o `code`).
- Secrets são armazenados criptografados (AES-256-GCM).

## Regras de senha

- Mínimo de 8 caracteres
- Ao menos 1 número
- Ao menos 1 caractere especial

## Endpoints de autenticação

### POST /auth/register
Cria usuário no tenant informado.

### POST /auth/login
Login por email e senha. Retorna access + refresh token.

### POST /auth/refresh
Rotaciona refresh token.

### POST /auth/logout
Revoga tokens do usuário logado.

### POST /auth/password/request-reset
Solicita reset de senha. Resposta sempre genérica (não confirma se usuário existe).

### POST /auth/password/reset
Reseta senha usando token válido (expira em 1h). Revoga refresh tokens existentes.

### GET /auth/providers
Lista provedores configurados para o tenant.

### GET /auth/oauth/:provider/start
Retorna `authUrl` para iniciar OAuth com provider configurado.

Query:
- `redirectUri`: deep link do app permitido (ex.: `coachpessoal://oauth`).

### GET /auth/oauth/:provider/callback
Callback do provider. Cria/associa usuário e redireciona para o app com `?code=...`.

### POST /auth/oauth/complete
Troca `code` recebido pelo app por tokens de sessão.

## Endpoints de configuração do tenant

### GET /tenant/oauth
Lista status das credenciais OAuth (somente admin).

### PUT /tenant/oauth/:provider
Atualiza credenciais OAuth (somente admin). Secrets não são retornados.

## Segurança e decisões

- Tokens de sessão:
  - Access token assinado (HMAC SHA-256) com TTL curto.
  - Refresh tokens persistidos com hash SHA-256 e rotação a cada uso.
- Tokens e secrets não são logados.
- Requests têm `x-request-id` para rastreio.
- Todas as queries críticas filtram por `tenant_id`.

## Endpoints existentes (calendário)

- `POST /oauth/google/exchange`
- `POST /oauth/outlook/exchange`
- `GET /accounts`
- `PATCH /accounts/:id/color`
- `PATCH /accounts/:id/tokens`
- `POST /accounts/:id/refresh`
- `DELETE /accounts/:id`
- `POST /accounts/ics`
- `POST /ics/fetch`
- `POST /sync/events`
- `GET /integration/events`
- `POST /integration/events/mark`

> Para integração com calendário, as rotas agora exigem `X-Tenant-ID` e `Authorization`.

## Observabilidade

- Logs incluem `request_id` quando disponível.
- Dados sensíveis (senhas, tokens, secrets) não são exibidos.


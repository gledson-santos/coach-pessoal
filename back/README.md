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
- MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URIS, MICROSOFT_TENANT_ID: credenciais do app Microsoft.
- MICROSOFT_ORGANIZATIONS_TENANT: tenant usado para contas corporativas (padrão `organizations`).
- MICROSOFT_ALLOWED_TENANTS: lista (separada por vírgula) de tenants permitidos para autenticação.

3. Crie as tabelas necessárias executando a migration inicial (ajuste o usuário/senha conforme o seu ambiente):

`
mysql -u root -p coach < migrations/001_init.sql
`

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
Fluxo idêntico ao do Google, porém usando o endpoint da Microsoft. Aceita parâmetros opcionais como 	enantId, scopes e color.

### GET /accounts
Lista todas as contas de calendário cadastradas no banco.

### PATCH /accounts/:id/color
Atualiza a cor associada à conta.

### DELETE /accounts/:id
Remove a conta e os tokens persistidos.

## Estrutura de Persistência

- src/db.ts expõe um pool de conexões MySQL (mysql2/promise).
- src/repositories/calendarAccountRepository.ts centraliza as operações de CRUD dos cadastros de contas.
- As migrations SQL estão em migrations/.

Com isso a API deixa de manter tokens apenas em memória e passa a usar MySQL como armazenamento primário, permitindo múltiplas contas por provedor.
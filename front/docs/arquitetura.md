# Arquitetura de integrações

Este documento descreve o fluxo de OAuth, a sincronização de eventos e o papel dos principais endpoints de integração.

## Fluxo OAuth (app → backend) e persistência de contas

1. **App inicia a conexão**: o frontend (em `services/*`) dispara o fluxo de OAuth para o provedor externo. Isso normalmente envolve redirecionar o usuário para o consentimento e obter um `code` de autorização.
2. **App envia o `code` ao backend**: após o consentimento, o app envia o `code` para o backend (handler em `src/index.ts`).
3. **Backend troca `code` por tokens**: o backend chama o provedor para trocar o `code` por `access_token`/`refresh_token`.
4. **Persistência da conta integrada**: os tokens e metadados de conta são salvos via `repositories` (camada de acesso a dados). Assim a conexão é preservada para sincronizações futuras.

## Sincronização de eventos (app → `/sync/events` → `app_events`)

1. **App solicita sincronização**: o frontend (em `services/*`) chama o endpoint `/sync/events` quando precisa trazer eventos para o app.
2. **Backend coleta e normaliza**: o handler em `src/index.ts` usa o provedor integrado (tokens persistidos) para buscar eventos remotos e normalizar o payload.
3. **Persistência em `app_events`**: o backend grava os eventos normalizados no banco por meio dos `repositories`, atualizando a tabela/coleção `app_events`.
4. **App consome os eventos**: o frontend consulta os eventos já persistidos para renderizar calendário e listas.

## Papel dos endpoints `/integration/events` e `/integration/events/mark`

- **`/integration/events`**: endpoint responsável por receber eventos de integração (ex.: webhooks do provedor) e/ou expor eventos provenientes da integração. Ele centraliza o recebimento/consulta de eventos ligados a integrações externas.
- **`/integration/events/mark`**: endpoint responsável por marcar eventos como processados/sincronizados/confirmados, evitando reprocessamento e controlando o estado do evento na integração.

## Onde cada parte vive

- **Frontend**: camada de chamadas e orquestração em `front/src/services/*`.
- **Backend**: handlers e rotas principais em `back/src/index.ts`.
- **Persistência**: acesso ao banco em `back/src/repositories/*`.

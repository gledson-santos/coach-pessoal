# Como testar a simulação de `invalid_grant`

Este guia explica como forçar o cenário de erro `invalid_grant` no aplicativo para validar o fluxo de reconexão do Google Calendar.

## Pré-requisitos

1. **Executar o app em modo de desenvolvimento** (`npx expo start`) **ou** definir a flag `EXPO_PUBLIC_ENABLE_CALENDAR_DEBUG=true` (também são aceitas `EXPO_PUBLIC_SHOW_CALENDAR_DEBUG=true` ou `EXPO_PUBLIC_FORCE_INVALID_GRANT_TEST=true`).
   - Ao rodar via Expo Go/CLI, o modo dev já habilita automaticamente o botão de debug.
   - Em builds de preview/produção é necessário incluir a variável de ambiente antes de iniciar o app.
2. Ter pelo menos uma conta Google já conectada na tela "Configurações".

## Passo a passo

1. Abra o aplicativo com o modo de debug habilitado (passo anterior).
2. Acesse **Configurações → Calendários conectados**.
3. Localize a conta Google desejada. Ao lado dos botões "Reconectar"/"Desconectar" haverá o botão **"Simular invalid_grant"**.
4. Toque no botão **"Simular invalid_grant"**. O app irá:
   - Marcar a conta como "Com erros".
   - Exibir a mensagem `invalid_grant (simulado para teste)`.
   - Mostrar o botão **"Reconectar"** para iniciar o fluxo de OAuth novamente.
5. Pressione **"Reconectar"** e siga o login do Google. Ao concluir, a conta volta para o estado "Conectado" e a sincronização pode ser testada normalmente.

## Limpeza após o teste

Se desejar, utilize o botão **"Desconectar"** para remover a conta da lista depois de validar o fluxo. Isso garante que nenhum estado de teste fique persistido.

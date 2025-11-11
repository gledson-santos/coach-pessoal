# Guia de build Android com Expo e EAS

Este passo a passo explica como gerar builds Android do app **Coach Pessoal** usando Expo Application Services (EAS). Ele cobre desde a preparação do ambiente até a publicação interna e na Play Store.

## 1. Pré-requisitos

1. **Node.js 18+** – recomendado instalar via [nvm](https://github.com/nvm-sh/nvm).
2. **Conta Expo** – crie uma em <https://expo.dev/signup> se ainda não tiver.
3. **Expo CLI e EAS CLI** – serão instaladas localmente via `npx`, então não é necessário instalá-las globalmente.
4. **Acesso ao repositório** e permissões para definir secrets no projeto Expo.
5. (Opcional) **Conta Google Play Console** para publicação oficial.

## 2. Instale dependências do projeto

```bash
npm install
```

> Caso esteja rodando dentro de um container, garanta que o diretório do projeto está montado e que o comando é executado em `/workspace/coach-pessoal/front`.

## 3. Autentique-se na Expo

```bash
npx expo login
```

Use o usuário da organização `gledsonsantos` ou outro com acesso ao projeto `pessoal-coach` (ID `e9098e67-678c-4439-87ff-74ce1d298597`).

## 4. Configure variáveis e secrets (se necessário)

Se o app depender de chaves privadas (ex.: tokens OAuth, URLs de backend), configure-as como secrets no projeto Expo:

```bash
npx eas secret:create --scope project --name NOME_DA_VARIAVEL --value valor
```

Esses secrets ficam disponíveis durante o processo de build sem precisar expor valores no repositório.

## 5. Verifique o arquivo `eas.json`

O repositório já possui o arquivo [`eas.json`](../eas.json) com três perfis de build:

- **development** – gera um *development build* com o cliente Expo Development (`developmentClient: true`), ideal para testar APIs nativas e hot reload via Expo.
- **preview** – gera um APK para distribuição interna rápida (por exemplo, via upload manual ou usando serviços como Firebase App Distribution).
- **production** – gera um Android App Bundle (AAB) pronto para enviar à Play Store.

Caso precise customizar permissões, ícones ou splash screens, atualize `app.json` antes do build.

## 6. Execute um build interno (APK)

Para gerar um APK de testes e distribuir manualmente:

```bash
npx eas build --platform android --profile preview
```

Durante o primeiro build o EAS pode solicitar gerar ou subir uma keystore. Você pode:

- Permitir que a Expo gere uma keystore gerenciada (recomendado para builds rápidos).
- Upload de uma keystore própria, se já existir uma.

Ao final do processo, o CLI exibirá uma URL para download do APK.

## 7. Faça um build de produção (AAB)

Quando estiver pronto para publicar na Play Store:

```bash
npx eas build --platform android --profile production
```

Baixe o arquivo `.aab` gerado e faça o upload no Google Play Console (fluxo *Internal testing*, *Closed testing* ou *Production*).

## 8. Envie diretamente pela CLI (opcional)

Com o build de produção concluído, é possível enviar o AAB direto para a Play Store via EAS Submit:

```bash
npx eas submit --platform android --profile production
```

Você precisará configurar as credenciais de serviço do Google Play ao rodar o comando pela primeira vez.

## 9. Teste localmente com Expo Go (alternativa rápida)

Para validar rapidamente sem gerar build nativo:

```bash
npm run android
```

Esse comando abre o Metro bundler e gera um QR code para abrir o app via Expo Go em um dispositivo Android físico ou emulador.

## 10. Dicas finais

- Acompanhe o status dos builds em <https://expo.dev/accounts/gledsonsantos/projects/pessoal-coach/builds>.
- Use `npx eas build:list` para listar builds antigos diretamente no terminal.
- Versione todas as mudanças em `app.json` e `eas.json` para manter histórico das configurações de build.
- Documente internamente quais secrets foram configurados e quem possui acesso às keystores.

Seguindo estes passos você terá builds Android prontos para testes internos ou publicação oficial com o mínimo de atrito.

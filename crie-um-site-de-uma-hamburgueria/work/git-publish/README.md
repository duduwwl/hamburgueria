# Hamburgueria Na Brasa

Site de pedidos da Hamburgueria Na Brasa, em Lavras (MG). O cardápio é público e o pedido no site aceita **apenas Pix**; dados de cliente e valores finais são tratados no Firebase.

## Segurança aplicada

- Firestore bloqueado por padrão para pedidos e dados internos.
- Cloud Functions recalculam catálogo, taxa de entrega e total no servidor.
- Pedidos não podem ser criados ou alterados diretamente pelo navegador.
- Acesso de gerente exige Firebase Authentication e o perfil ativo `staff/{uid}`.
- App Check com reCAPTCHA v3 protege as chamadas públicas contra abuso.
- O navegador mantém somente a sacola, nunca pedidos, endereços ou permissões de gerente.

## Estrutura

- `outputs/` — site estático publicado pelo Firebase Hosting.
- `functions/` — API confiável de pedidos, rastreio e gerente.
- `firestore.rules` — regras restritivas do banco.
- `scripts/seed-products.js` — carga inicial manual do catálogo.
- `.github/workflows/firebase-deploy.yml` — publicação automática após a configuração do GitHub Actions.

## Publicação segura

Siga [FIREBASE_SETUP.md](FIREBASE_SETUP.md) antes de ativar o deploy automático. Nunca coloque no repositório uma service account, senha, token, chave Pix ou dado de cartão.

> As Cloud Functions exigem o plano Blaze do Firebase. O workflow só as publica quando a variável de repositório `DEPLOY_FUNCTIONS` estiver configurada como `true` pelo proprietário.

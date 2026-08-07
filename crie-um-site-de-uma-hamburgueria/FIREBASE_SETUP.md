# Firebase de produção — Hamburgueria Na Brasa

Projeto Firebase: `hamburgueria-ee939`  
Região das Cloud Functions: `southamerica-east1` (São Paulo)

Este repositório já contém regras do Firestore, funções de pedido, índices,
seed do catálogo e workflow do GitHub. O Firestore de produção em
`southamerica-east1` e o login por e-mail/senha já foram ativados neste
projeto. As etapas abaixo que ainda faltam devem ser feitas pelo proprietário
nas contas Firebase, Google Cloud e GitHub. Nunca envie por chat ou inclua no
repositório senhas, tokens, chaves de pagamento ou JSON de conta de serviço.

## Ordem recomendada de ativação

1. Confira Firestore e Authentication e conclua o App Check no Firebase Console.
2. Crie o primeiro gerente pelo Firebase Console.
3. Faça o seed do catálogo com uma credencial local guardada fora deste repo.
4. Configure o secret e a variável do GitHub.
5. Só então habilite o deploy de Functions e publique.
6. Execute o checklist de teste antes de divulgar o endereço do site.

O workflow bloqueia todo deploy de produção enquanto a variável
`DEPLOY_FUNCTIONS` não for `true`. Isso é intencional: evita publicar uma tela
que depende da API segura antes que as Functions estejam disponíveis.

## 1. Firebase Console: Firestore e Authentication

Já configurado neste projeto:

- Firestore em modo de produção na região `southamerica-east1` (São Paulo).
- Provedor Firebase Authentication **E-mail/senha** ativado.

Use os passos abaixo apenas para conferir essa base ou criar a primeira conta
de gerente.

1. Abra o projeto **Burger** no [Firebase Console](https://console.firebase.google.com/).
2. Em **Build → Firestore Database**, clique em **Criar banco de dados**.
   Escolha **modo de produção** e uma localização definitiva próxima ao negócio
   (prefira `southamerica-east1`, se disponível). A localização não pode ser
   alterada depois.
3. Em **Build → Authentication → Sign-in method**, ative **E-mail/senha**.
4. Em **Authentication → Users**, crie o usuário de e-mail e senha do gerente.
   Guarde a senha fora do código e use uma senha forte.

As regras deste projeto não permitem que o navegador escreva pedidos, produtos,
perfis de equipe ou documentos internos. O Console e o Admin SDK continuam
com acesso administrativo; trate-os como áreas privadas.

## 2. Primeiro gerente: documento `staff/<UID>`

1. Em **Authentication → Users**, abra o usuário do gerente e copie o **UID**.
2. Em **Firestore Database → Dados**, crie a coleção `staff`.
3. Crie um documento cujo ID seja **exatamente o UID copiado**.
4. Adicione estes campos com os tipos corretos:

```json
{
  "role": "manager",
  "active": true,
  "displayName": "Gerente"
}
```

`role` precisa ser texto e `active` precisa ser booleano, não a string
`"true"`. As Functions verificam esse documento no servidor em toda leitura
ou mudança de pedido. Para revogar imediatamente uma conta, mantenha o mesmo
documento e mude `active` para `false`.

O script `functions/scripts/set-manager-claim.js` é apenas um fallback de
migração. O documento `staff/<UID>` é a fonte de autorização recomendada.

## 3. App Check com reCAPTCHA v3

As callables (`quoteDelivery`, `createOrder`, `trackOrder`,
`listManagerOrders` e `updateOrderStatus`) foram configuradas com
`enforceAppCheck: true`. Sem App Check, o site **deve** recusar a criação de
pedidos; não desative essa proteção para colocar o site no ar.

1. No Console, abra **Build → App Check** e selecione o app web
   `hamburgueria.web`.
2. Registre-o com o provedor **reCAPTCHA v3**, pois o cliente atual usa
   `ReCaptchaV3Provider`. O Firebase recomenda reCAPTCHA Enterprise em novas
   integrações; se optar por Enterprise, altere antes o provedor em
   `outputs/firebase-client.js` para o provedor Enterprise correspondente.
   Não misture uma site key v3 com o provedor Enterprise.
3. No painel do reCAPTCHA, inclua os domínios autorizados:

   - `hamburgeria-ee939.web.app`
   - `hamburgeria-ee939.firebaseapp.com`
   - seu domínio próprio, caso venha a conectar um

4. Copie a **site key** do reCAPTCHA. Ela é um identificador público, mas não
   a confunda com uma chave secreta ou com uma conta de serviço. A **secret
   key** correspondente é usada apenas no registro do App Check dentro do
   Firebase Console e nunca deve entrar no JavaScript, GitHub ou Firestore.
5. Defina a chave pública uma única vez em `outputs/app-config.js`:

```js
window.NABRASA_RECAPTCHA_SITE_KEY = 'SUA_SITE_KEY_PUBLICA';
```

Esse arquivo já é carregado antes de `firebase-client.js` nas duas páginas. A
chave precisa estar disponível antes do módulo, pois é ali que o App Check é
inicializado. Em desenvolvimento local, use o mecanismo de debug do App Check
em vez de enfraquecer Functions de produção.

Se adicionar um domínio próprio depois, inclua-o também em
`callableOptions.cors` em `functions/index.js`, publique primeiro as
Functions e depois a hospedagem/DNS. Os domínios padrão do Firebase já estão
permitidos.

## 4. Seed manual e seguro do catálogo

O servidor só aceita produtos ativos em `products`. Rode o seed antes de
habilitar o checkout em produção; caso contrário, `createOrder` recusará os
itens por segurança.

1. Instale as dependências locais:

```powershell
npm --prefix functions install
```

2. Gere uma chave de conta de serviço somente para esta tarefa em
   **Firebase Console → Configurações do projeto → Contas de serviço**. Salve o
   arquivo JSON em uma pasta privada, fora do repositório.
3. Execute o seed explicitamente:

```powershell
$env:FIREBASE_SERVICE_ACCOUNT = 'C:\caminho-seguro\service-account.json'
$env:CONFIRM_SEED = 'hamburgueria-ee939'
node scripts\seed-products.js
```

O script grava 30 produtos e 4 promoções. Todos os valores usam `priceCents`.
O navegador pode mostrar o cardápio estático, mas preços, taxa e total são
sempre recalculados no servidor. Ao alterar preço ou disponibilidade, atualize
o documento Firestore correspondente e o conteúdo visual do cardápio na mesma
mudança.

## 5. GitHub Actions: secret, ambiente e publicação

O workflow está em `.github/workflows/firebase-deploy.yml` e usa o projeto
`hamburgueria-ee939`.

1. No repositório GitHub, abra **Settings → Secrets and variables → Actions**.
2. Em **Secrets**, crie o secret exato:

```text
FIREBASE_SERVICE_ACCOUNT_HAMBURGUERIA_EE939
```

Cole nele o conteúdo completo do JSON da conta de serviço de deploy. Não use o
arquivo como conteúdo de um commit, issue, pull request ou variável pública.
Prefira uma conta de serviço exclusiva para CI com as permissões mínimas de
Hosting, Firebase Rules/Firestore, Cloud Functions, Cloud Build e Service
Account User necessárias ao deploy.

3. Em **Environments**, crie/configure o ambiente `production`. Para maior
   segurança, adicione revisão obrigatória antes de publicar.
4. Em **Variables**, crie a variável de repositório:

```text
DEPLOY_FUNCTIONS=true
```

5. Faça commit e push para `main`, ou use **Actions → Deploy Firebase
   (produção) → Run workflow**. No primeiro deploy, marque
   **Executar a carga inicial/atualização explícita do catálogo** para que o
   catálogo seja gravado antes de o Hosting ser publicado. Nos deploys normais,
   deixe essa opção desmarcada para não sobrescrever mudanças de preços ou
   disponibilidade feitas pela equipe.

O pipeline publica primeiro Functions, regras e índices; o Hosting só é
publicado se essa etapa passar. A ordem evita expor um front-end que aponta
para uma API ausente ou com regras não implantadas.

## 6. Limitação importante: plano Blaze

Cloud Functions exige o plano **Blaze**. Enquanto o projeto estiver em Spark,
não defina `DEPLOY_FUNCTIONS=true`; o workflow não fará deploy de produção.

Antes de ativar Blaze:

- confira a conta de faturamento e permissões do Google Cloud;
- crie orçamento e alertas de cobrança;
- deixe limites de instância das Functions como estão no código;
- confirme App Check, seed e conta de gerente;
- faça um pedido de teste completo.

Mesmo em Blaze, Pix por enquanto é apenas uma **opção registrada** com status
`PENDING`. Não há QR Code, chave Pix, conciliação ou cobrança automática.
Para receber pagamento real, integre um gateway no servidor e guarde as
credenciais no Secret Manager; nunca no HTML, Firestore ou GitHub.

## Checklist de aceite antes de abrir ao público

- [ ] O Hosting abre em HTTPS no domínio Firebase.
- [ ] App Check está ativo e um pedido não retorna erro de App Check.
- [ ] `quoteDelivery` calcula somente CEPs de Lavras previstos no servidor.
- [ ] Um pedido Pix recebe código `NB...` aleatório e a taxa/total corretos.
- [ ] Alterar preço, total ou status no DevTools não altera o pedido salvo.
- [ ] A consulta pública por código mostra apenas status, sem nome, telefone ou endereço.
- [ ] Sem login, a área de gerente não lista pedidos.
- [ ] Com `staff/<UID>` ativo, o gerente lista pedidos e consegue mover o
      status apenas pela sequência permitida.
- [ ] Com `active: false`, a mesma conta perde acesso à lista e à atualização.
- [ ] Nenhum JSON de conta de serviço, token, senha ou chave de pagamento foi
      enviado ao GitHub.

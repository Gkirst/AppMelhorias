# Implantação no Firebase da empresa

Este guia foi escrito para quem vai cuidar do aplicativo na TI. A ideia é implantar sem depender de uma conta pessoal ou de senhas compartilhadas.

## 1. Criar o projeto e definir responsáveis

Crie um projeto no [console Firebase](https://console.firebase.google.com/) sob a conta ou organização da empresa. Defina pelo menos dois administradores autorizados. Registre a região do Firestore, a política de retenção e quem receberá alertas de custo. O aplicativo não precisa de servidor físico na fábrica.

No projeto, habilite **Authentication → E-mail/senha** e crie um **Cloud Firestore** em modo restrito. Não deixe as regras temporárias de teste publicadas.

## 2. Preparar as contas

Crie os usuários na área **Authentication → Users**. Para cada UID criado, adicione manualmente um documento `users/{uid}` no Firestore:

```json
{
  "name": "Nome completo",
  "email": "pessoa@empresa.com.br",
  "role": "collaborator",
  "active": true
}
```

Para um supervisor, use `"role": "supervisor"`. Os demais campos devem continuar iguais. O UID do documento precisa ser exatamente o UID do Authentication. Se `active` for `false` ou o documento não existir, a conta não acessa os dados. Não dê a colaboradores acesso ao console Firebase; as permissões do app são diferentes das permissões administrativas do console.

O app não cria contas nem altera papéis. Para muitos usuários, a TI pode automatizar o provisionamento com ferramentas administrativas próprias, depois de revisar o processo.

## 3. Publicar as regras

O arquivo `firestore.rules` acompanha o projeto; `firebase.json` aponta para ele. Revise as regras com a equipe de segurança, teste no [Emulator Suite](https://firebase.google.com/docs/firestore/security/test-rules-emulator) e só então publique no projeto da empresa. Um caminho possível é usar o Firebase CLI:

```bat
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore
```

O comando de publicação substitui as regras atuais do projeto selecionado. Confirme o projeto antes de executar. Não use um projeto que já tenha dados de outra aplicação sem combinar a alteração com a equipe responsável.

As regras exigem que proposta e primeiro evento de histórico sejam gravados juntos. Aprovação, andamento, não conclusão e exclusão também exigem um evento na mesma operação. Observações são eventos próprios. Colaboradores não consultam propostas excluídas; supervisores podem consultá-las e ver o histórico geral. O aplicativo nunca apaga documentos fisicamente.

## 4. Conectar o app

Registre um aplicativo no Firebase e copie os dados de configuração do SDK para as variáveis de `.env.example`. Crie um `.env` local, sem enviá-lo ao GitHub. Para builds na nuvem, configure os mesmos valores `EXPO_PUBLIC_FIREBASE_*` no [ambiente `preview` ou `production` do EAS](https://docs.expo.dev/eas/environment-variables/). O arquivo `eas.json` já seleciona esses ambientes nos perfis conectados.

Esses valores identificam o projeto e estarão dentro do APK; não são senhas de administrador. A proteção dos dados depende de Authentication, das regras do Firestore e do controle das contas. Jamais coloque um arquivo de conta de serviço dentro do aplicativo.

Antes do build, substitua o identificador de exemplo `br.com.suaempresa.painelmelhorias` em `app.json` por um identificador aprovado pela empresa e disponível na Google Play. Vincule o projeto à conta Expo/EAS da empresa; nenhum identificador de conta pessoal está no repositório.

## 5. Testar antes da distribuição

Use pelo menos duas contas e dois aparelhos conectados à internet:

1. Colaborador cria uma proposta; ambos veem **Aguardando aprovação**.
2. Colaborador tenta aprovar: a opção não aparece e uma tentativa direta no banco deve ser negada pelas regras.
3. Supervisor aprova, inicia e conclui; cada mudança aparece no outro aparelho e no histórico da proposta.
4. Em outra proposta, supervisor escolhe **Não concluir** sem motivo: o app bloqueia. Com motivo, o status muda e todos veem a explicação; ambos conseguem comentar.
5. Supervisor exclui uma proposta: ela desaparece para o colaborador, mas permanece em **Propostas excluídas** e no histórico geral do supervisor.
6. Desative uma conta em `users/{uid}` e confirme que ela deixa de ler e gravar dados.
7. Feche e reabra o app, teste a senha visível/oculta, o teclado em formulários longos e os dois toques em Voltar no Android.

Revise também regras de privacidade, backup, recuperação, monitoramento e custos antes de colocar dados reais da fábrica. Para uso em escala maior, planeje paginação do histórico geral: a versão atual acompanha os eventos de cada proposta aberta no painel do supervisor.

## 6. Gerar e distribuir

O perfil `preview` gera um APK para teste interno. O perfil `production` gera um AAB para distribuição por loja. Defina quem pode baixar e instalar o APK e como serão feitas as atualizações. Um APK de teste não se atualiza sozinho em todos os aparelhos.

As propostas criadas na versão offline não são importadas automaticamente. Se for necessário migrá-las, a TI deve planejar uma importação aprovada, com conferência dos dados e dos responsáveis.

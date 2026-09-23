# Implantação no Firebase da empresa

Este guia foi escrito para quem vai cuidar do aplicativo na TI. A ideia é implantar sem depender de uma conta pessoal ou de senhas compartilhadas.

O repositório contém o fluxo atual de custo, retorno financeiro, escolha de aprovadores e aprovação individual nos modos offline e Firebase. Ele não contém um Firebase corporativo já configurado, contas de funcionários ou um APK conectado pronto para distribuir. Para instalar na empresa, conclua as etapas abaixo e valide o resultado no ambiente dela.

## 1. Criar o projeto e definir responsáveis

Crie um projeto no [console Firebase](https://console.firebase.google.com/) sob a conta ou organização da empresa. Defina pelo menos dois administradores autorizados. Registre a região do Firestore, a política de retenção e quem receberá alertas de custo. O aplicativo não precisa de servidor físico na fábrica.

No projeto, habilite **Authentication → E-mail/senha** e crie um **Cloud Firestore** em modo restrito. Não deixe as regras temporárias de teste publicadas.

## 2. Preparar as contas

Crie os usuários na área **Authentication → Users**. Para cada UID criado, adicione manualmente um documento `users/{uid}` no Firestore:

```json
{
  "name": "Nome completo",
  "email": "pessoa@empresa.com.br",
  "employeeNumber": "12345",
  "role": "collaborator",
  "department": "Extrusão",
  "active": true
}
```

Use `"role": "area_manager"` ou `"role": "manager"` para os gestores. Os dois perfis têm os mesmos privilégios de gestão no aplicativo. Cada pessoa precisa da própria conta e UID. A matrícula (`employeeNumber`) deve ser única. Preencha `department` com o setor do gestor responsável: esse nome aparecerá no cadastro da proposta. O UID do documento precisa ser exatamente o UID do Authentication. Se `active` for `false` ou o documento não existir, a conta não acessa os dados. Não dê a colaboradores acesso ao console Firebase; as permissões do app são diferentes das permissões administrativas do console.

Os usuários ativos conseguem consultar nomes, matrículas, departamentos, papéis e e-mails dos perfis internos. Cadastre apenas informações profissionais necessárias. O autor busca um gestor pela matrícula ao criar a proposta. Depois, qualquer gestor ativo busca pela matrícula e escolhe de dois a cinco aprovadores. Antes disso, pode marcar **Não aprovar**. Não há uma lista fixa. Cada aprovador confirma com a própria conta, sem precisar publicar comentário. Após a última aprovação, a proposta entra automaticamente em **Em andamento**. Somente o autor pode marcá-la como **Concluída** ou excluí-la. Gestores podem registrar a não conclusão com motivo.

O app não cria contas nem altera papéis. Para muitos usuários, a TI pode automatizar o provisionamento com ferramentas administrativas próprias, depois de revisar o processo.

O login conectado usa atualmente **Firebase Authentication com e-mail e senha**. Uma conta já existente no RH, Active Directory ou provedor de identidade da empresa não é reconhecida automaticamente; usar o login corporativo exigirá uma integração adicional, a ser definida com a TI.

## 3. Publicar as regras

O arquivo `firestore.rules` acompanha o projeto; `firebase.json` aponta para ele. Revise as regras com a equipe de segurança, teste no [Emulator Suite](https://firebase.google.com/docs/firestore/security/test-rules-emulator) e só então publique no projeto da empresa. Um caminho possível é usar o Firebase CLI:

```bat
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore
```

O comando de publicação substitui as regras atuais do projeto selecionado. Confirme o projeto antes de executar. Não use um projeto que já tenha dados de outra aplicação sem combinar a alteração com a equipe responsável.

As regras exigem que proposta e primeiro evento de histórico sejam gravados juntos. A seleção dos gestores, cada aprovação individual, o andamento, a conclusão, a não conclusão e a exclusão também exigem um evento na mesma operação. Um gestor não pode aprovar por outro. Observações são eventos próprios. Colaboradores não consultam propostas excluídas; gestores podem consultá-las e ver o histórico geral. O aplicativo nunca apaga documentos fisicamente.

O custo de implantação e o retorno esperado são estimativas informadas em reais, armazenadas em centavos. O autor informa se o retorno é mensal ou anual, e o aplicativo mostra as duas visualizações. A observação sobre a origem da estimativa é obrigatória. Os valores não representam orçamento aprovado ou economia comprovada: defina uma conferência financeira interna antes de usá-los para autorizar gastos.

## 4. Conectar o app

Registre um aplicativo no Firebase e copie os dados de configuração do SDK para as variáveis de `.env.example`. Crie um `.env` local, sem enviá-lo ao GitHub. Para builds na nuvem, configure os mesmos valores `EXPO_PUBLIC_FIREBASE_*` no [ambiente `preview` ou `production` do EAS](https://docs.expo.dev/eas/environment-variables/). O arquivo `eas.json` já seleciona esses ambientes nos perfis conectados.

Esses valores identificam o projeto e estarão dentro do APK; não são senhas de administrador. A proteção dos dados depende de Authentication, das regras do Firestore e do controle das contas. Jamais coloque um arquivo de conta de serviço dentro do aplicativo.

Antes do build, substitua o identificador de exemplo `br.com.suaempresa.painelmelhorias` em `app.json` por um identificador aprovado pela empresa e disponível na Google Play. Vincule o projeto à conta Expo/EAS da empresa; nenhum identificador de conta pessoal está no repositório.

Após `npx eas-cli build:configure`, confira o `projectId` acrescentado ao `app.json`. Ele deve pertencer à conta Expo/EAS da empresa. Não reutilize o vínculo de uma demonstração pessoal para distribuir a versão corporativa.

## 5. Testar antes da distribuição

Use pelo menos quatro contas (colaborador, gestor da área e dois gestores aprovadores) em aparelhos conectados à internet:

1. Colaborador cria uma proposta com custo, retorno, período e justificativa. Confira a conversão entre valor mensal e anual.
2. Um gestor busca pela matrícula e escolhe dois gestores diferentes. A proposta passa para **Aguardando aprovações**.
3. O primeiro gestor aprova; a execução ainda deve estar bloqueada. Uma tentativa de aprovar usando a conta de outro gestor deve ser negada pelas regras.
4. O segundo gestor aprova sem comentar; a proposta passa automaticamente para **Em andamento**. O autor conclui a execução, e cada ação aparece no histórico.
5. Em outra proposta, um gestor escolhe **Não concluir** sem motivo: o app bloqueia. Com motivo, todos veem a explicação e podem comentar.
6. Um gestor tenta excluir a proposta de outra pessoa: a ação deve ser negada. O autor exclui a própria proposta: ela desaparece para colaboradores, mas permanece em **Propostas excluídas** e no histórico geral dos gestores.
7. Desative uma conta em `users/{uid}` e confirme que ela deixa de ler e gravar dados.
8. Feche e reabra o app, teste a senha visível/oculta, o teclado em formulários longos e os dois toques em Voltar no Android.

Revise também regras de privacidade, backup, recuperação, monitoramento e custos antes de colocar dados reais da fábrica. Para uso em escala maior, planeje paginação do histórico geral: a versão atual acompanha os eventos de cada proposta aberta no painel dos gestores.

## 6. Gerar e distribuir

O perfil `preview` gera um APK para teste interno. O perfil `production` gera um AAB para distribuição por loja. Defina quem pode baixar e instalar o APK e como serão feitas as atualizações. Um APK de teste não se atualiza sozinho em todos os aparelhos.

As propostas criadas na versão offline não são importadas automaticamente. Propostas de versões anteriores do esquema Firestore também precisam de migração antes de aplicar estas regras: os novos campos de custo, retorno, gestor da área e aprovadores são obrigatórios. A TI deve planejar uma importação ou migração aprovada, com conferência dos dados e dos responsáveis.

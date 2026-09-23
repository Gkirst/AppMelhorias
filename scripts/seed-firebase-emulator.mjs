import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const projectId = 'demo-app-melhorias-local';
const authUrl = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts';
const people = [
  { name: 'Colaborador de teste', email: 'colaborador@demo.local', password: '000000',
    employeeNumber: '1000', role: 'collaborator', department: 'Produção' },
  { name: 'Gestor da área', email: 'gestor.area@demo.local', password: '111111',
    employeeNumber: '2000', role: 'area_manager', department: 'Produção' },
  { name: 'Gestor da manutenção', email: 'gestor.manutencao@demo.local', password: '222222',
    employeeNumber: '3000', role: 'manager', department: 'Manutenção' },
  { name: 'Gestor de custos', email: 'gestor.custos@demo.local', password: '333333',
    employeeNumber: '4000', role: 'manager', department: 'Custos' },
];

async function authRequest(action, person) {
  const response = await fetch(`${authUrl}:${action}?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: person.email, password: person.password, returnSecureToken: true }),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

async function ensureAccount(person) {
  let result = await authRequest('signUp', person);
  if (!result.ok && result.data.error?.message === 'EMAIL_EXISTS') {
    result = await authRequest('signInWithPassword', person);
  }
  if (!result.ok || !result.data.localId) {
    throw new Error(`Não foi possível preparar ${person.email}: ${result.data.error?.message || 'erro desconhecido'}`);
  }
  return result.data.localId;
}

async function main() {
  const accounts = [];
  for (const person of people) accounts.push({ ...person, uid: await ensureAccount(person) });

  const environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1', port: 8080,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
  try {
    await environment.withSecurityRulesDisabled(async context => {
      for (const { uid, password, ...profile } of accounts) {
        await setDoc(doc(context.firestore(), 'users', uid), { ...profile, active: true });
      }
    });
  } finally {
    await environment.cleanup();
  }
  console.log('Contas locais prontas. Use os e-mails e senhas de teste abaixo:');
  for (const person of people) console.log(`${person.email} / ${person.password} · matrícula ${person.employeeNumber}`);
  console.log('Nenhuma proposta foi criada. Estes dados existem somente no emulador local.');
}

main().catch(error => {
  console.error('Inicie os emuladores de Auth e Firestore antes de preparar as contas.');
  console.error(error.message);
  process.exitCode = 1;
});

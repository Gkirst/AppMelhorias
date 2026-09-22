import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, serverTimestamp, setDoc, writeBatch,
} from 'firebase/firestore';

let environment;
const projectId = 'proposal-one';
const profiles = {
  employee: { name: 'Colaborador', email: 'employee@example.test', role: 'collaborator', department: 'Extrusão', active: true },
  area: { name: 'Gestora da área', email: 'area@example.test', role: 'area_manager', department: 'Extrusão', active: true },
  managerOne: { name: 'Gestor da manutenção', email: 'manager1@example.test', role: 'manager', department: 'Manutenção', active: true },
  managerTwo: { name: 'Gestora de custos', email: 'manager2@example.test', role: 'manager', department: 'Custos', active: true },
};

function projectData(status = 'review') {
  return {
    title: 'Reduzir perdas no processo', description: 'Proposta de teste das aprovações.',
    area: 'Extrusão', ownerName: 'Equipe', authorId: 'employee', authorName: 'Colaborador',
    areaManagerId: 'area', approverIds: ['managerOne', 'managerTwo'],
    approvalStates: { managerOne: 'pending', managerTwo: 'pending' },
    costCents: 120000, returnCents: 30000, returnPeriod: 'month', estimateNotes: 'Medição de perdas mensais.',
    status, archived: false, nonCompletionReason: '', createdAt: new Date(), updatedAt: new Date(), lastActionId: 'seed',
  };
}
function client(uid) { return environment.authenticatedContext(uid).firestore(); }
function approvalBatch(uid, states, status) {
  const database = client(uid);
  const project = doc(database, 'projects', projectId);
  const event = doc(collection(project, 'events'));
  const batch = writeBatch(database);
  batch.update(project, { approvalStates: states, status, updatedAt: serverTimestamp(), lastActionId: event.id });
  batch.set(event, { type: 'manager_approved', actorId: uid, actorName: profiles[uid].name,
    detail: '', createdAt: serverTimestamp() });
  return batch.commit();
}
function startBatch(status) {
  const database = client('area');
  const project = doc(database, 'projects', projectId);
  const event = doc(collection(project, 'events'));
  const batch = writeBatch(database);
  batch.update(project, { status, nonCompletionReason: '', updatedAt: serverTimestamp(), lastActionId: event.id });
  batch.set(event, { type: status, actorId: 'area', actorName: profiles.area.name,
    detail: '', createdAt: serverTimestamp() });
  return batch.commit();
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-app-melhorias-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    await Promise.all(Object.entries(profiles).map(([id, profile]) => setDoc(doc(database, 'users', id), profile)));
    await setDoc(doc(database, 'projects', projectId), projectData());
  });
});
after(async () => { if (environment) await environment.cleanup(); });

test('cada gestor aprova somente a própria etapa', async () => {
  await assertSucceeds(approvalBatch('managerOne', { managerOne: 'approved', managerTwo: 'pending' }, 'review'));
  const project = await getDoc(doc(client('employee'), 'projects', projectId));
  if (project.data()?.status !== 'review') throw new Error('A proposta avançou antes de todas as aprovações.');
  await assertFails(approvalBatch('managerOne', { managerOne: 'approved', managerTwo: 'approved' }, 'approved'));
  await assertSucceeds(approvalBatch('managerTwo', { managerOne: 'approved', managerTwo: 'approved' }, 'approved'));
  const approved = await getDoc(doc(client('employee'), 'projects', projectId));
  if (approved.data()?.status !== 'approved') throw new Error('A proposta não foi liberada após todas as aprovações.');
});

test('colaborador não pode assinar a aprovação de um gestor', async () => {
  await assertFails(approvalBatch('employee', { managerOne: 'approved', managerTwo: 'pending' }, 'review'));
});

test('gestor da área não inicia antes de todas as aprovações', async () => {
  await assertFails(startBatch('in_progress'));
  await assertSucceeds(approvalBatch('managerOne', { managerOne: 'approved', managerTwo: 'pending' }, 'review'));
  await assertSucceeds(approvalBatch('managerTwo', { managerOne: 'approved', managerTwo: 'approved' }, 'approved'));
  await assertSucceeds(startBatch('in_progress'));
});

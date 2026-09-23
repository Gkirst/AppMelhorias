import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, ToastAndroid,
  useWindowDimensions, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import {
  addDoc, collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where, writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

type Role = 'collaborator' | 'area_manager' | 'manager';
type Profile = { name: string; email: string; employeeNumber?: string; role: Role; department: string; active: boolean };
type DirectoryPerson = Profile & { id: string };
type Status = 'pending' | 'review' | 'approved' | 'rejected' | 'in_progress' | 'completed' | 'not_completed';
type Project = {
  id: string; title: string; description: string; area: string; ownerName: string;
  authorId: string; authorName: string; status: Status; archived: boolean;
  responsibleCollaboratorId: string; approverIds: string[]; approvalStates: Record<string, 'pending' | 'approved'>;
  costCents: number; returnCents: number; returnPeriod: 'month' | 'year'; estimateNotes: string;
  nonCompletionReason: string; createdAt?: Timestamp; updatedAt?: Timestamp; lastActionId: string;
};
type EventType = 'created' | 'review_started' | 'manager_approved' | 'rejected' | 'in_progress' | 'completed' | 'not_completed' | 'archived' | 'observation';
type Event = { id: string; type: EventType; actorId: string; actorName: string; detail: string; createdAt?: Timestamp; projectTitle?: string };

const BLUE = '#2279A9', GREEN = '#78B32F', INK = '#173348', MUTED = '#5E7280';
const statuses: Record<Status, string> = {
  pending: 'Aguardando gestores', review: 'Aguardando aprovações', approved: 'Aprovada por todos', rejected: 'Não aprovada',
  in_progress: 'Em andamento', completed: 'Concluída', not_completed: 'Não concluída',
};
const actions: Record<EventType, string> = {
  created: 'Proposta criada', review_started: 'Gestores definidos', manager_approved: 'Aprovação registrada', rejected: 'Proposta não aprovada',
  in_progress: 'Execução iniciada', completed: 'Proposta concluída',
  not_completed: 'Proposta não concluída', archived: 'Proposta excluída', observation: 'Observação adicionada',
};
const formatMoney = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function parseMoney(value: string) {
  return /^\d{1,10}$/.test(value) ? Number(value) * 100 : null;
}
function displayDate(value?: Timestamp) {
  return value?.toDate ? value.toDate().toLocaleString('pt-BR') : 'Sincronizando...';
}
function showError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const message = code === 'permission-denied' ? 'Ação negada pelo Firebase. Confirme com a TI se os perfis estão ativos e se as regras foram atualizadas.'
    : code === 'auth/invalid-credential' ? 'E-mail ou senha incorretos.'
    : code === 'auth/too-many-requests' ? 'Muitas tentativas. Aguarde um pouco e tente novamente.'
    : code === 'unavailable' && process.env.EXPO_PUBLIC_FIREBASE_EMULATOR === 'true'
      ? 'O Firebase local não está disponível. Inicie os emuladores de Authentication e Firestore no computador.'
    : 'Não foi possível concluir. Confira a internet e tente novamente.';
  Alert.alert('Atenção', message);
}
function Button({ title, onPress, disabled = false, outline = false, danger = false }: {
  title: string; onPress: () => void; disabled?: boolean; outline?: boolean; danger?: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.button, outline && s.outline, danger && s.danger, disabled && s.disabled]}>
    <Text style={[s.buttonText, outline && { color: BLUE }, danger && { color: '#B22934' }]}>{title}</Text>
  </Pressable>;
}
function Field({ label, value, onChange, multiline = false, maxLength, numeric = false }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; maxLength?: number; numeric?: boolean;
}) {
  return <View style={s.field}><Text style={s.label}>{label}</Text>
    <TextInput style={[s.input, multiline && s.multiline]} value={value}
      onChangeText={text => onChange(numeric ? text.replace(/\D/g, '').slice(0, 10) : text)}
      keyboardType={numeric ? 'number-pad' : 'default'}
      maxLength={maxLength} multiline={multiline} placeholderTextColor="#9BA8AF" />
  </View>;
}

export default function FirebaseApp() {
  const { width } = useWindowDimensions();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showNoComplete, setShowNoComplete] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [responsibleCollaboratorId, setResponsibleCollaboratorId] = useState('');
  const [collaboratorLookup, setCollaboratorLookup] = useState('');
  const [approverLookup, setApproverLookup] = useState('');
  const [cost, setCost] = useState('');
  const [expectedReturn, setExpectedReturn] = useState('');
  const [returnPeriod, setReturnPeriod] = useState<'month' | 'year'>('month');
  const [estimateNotes, setEstimateNotes] = useState('');
  const [chosenApprovers, setChosenApprovers] = useState<string[]>([]);
  const [observation, setObservation] = useState('');
  const [reason, setReason] = useState('');
  const lastBackPress = useRef(0);
  const navigation = useRef({ selectedId, creating, showHistory, showNoComplete, showAllHistory, showArchived });
  navigation.current = { selectedId, creating, showHistory, showNoComplete, showAllHistory, showArchived };
  const resetForm = () => {
    setTitle(''); setDescription(''); setResponsibleCollaboratorId(''); setCollaboratorLookup('');
    setCost(''); setExpectedReturn(''); setReturnPeriod('month'); setEstimateNotes('');
  };
  const goBack = () => {
    const page = navigation.current;
    if (page.showNoComplete) { setShowNoComplete(false); return true; }
    if (page.showHistory) { setShowHistory(false); return true; }
    if (page.selectedId) { setSelectedId(null); setChosenApprovers([]); return true; }
    if (page.creating) { resetForm(); setCreating(false); return true; }
    if (page.showAllHistory) { setShowAllHistory(false); return true; }
    if (page.showArchived) { setShowArchived(false); return true; }
    return false;
  };

  useEffect(() => {
    let stopProfile = () => {};
    const stopAuth = onAuthStateChanged(auth, nextUser => {
      stopProfile(); setUser(nextUser); setProfile(null); setProjects([]); setSelectedId(null);
      if (!nextUser) { setLoading(false); return; }
      stopProfile = onSnapshot(doc(db, 'users', nextUser.uid), snap => {
        setProfile(snap.exists() ? snap.data() as Profile : null);
        setLoading(false);
      }, error => { setLoading(false); showError(error); });
    });
    return () => { stopProfile(); stopAuth(); };
  }, []);
  useEffect(() => {
    if (!user || !profile?.active) return;
    const base = collection(db, 'projects');
    const listQuery = profile.role !== 'collaborator' ? query(base) : query(base, where('archived', '==', false));
    return onSnapshot(listQuery, snap => {
      setProjects(snap.docs.map(item => ({ id: item.id, ...item.data() } as Project))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    }, showError);
  }, [user?.uid, profile?.active, profile?.role]);
  useEffect(() => {
    if (!user || !profile?.active) { setDirectory([]); return; }
    return onSnapshot(collection(db, 'users'), snap => {
      setDirectory(snap.docs.map(item => ({ id: item.id, ...item.data() } as DirectoryPerson))
        .filter(person => person.active));
    }, showError);
  }, [user?.uid, profile?.active]);
  useEffect(() => {
    if (!selectedId || !user || !profile?.active) { setEvents([]); return; }
    return onSnapshot(query(collection(db, 'projects', selectedId, 'events')), snap => {
      setEvents(snap.docs.map(item => ({ id: item.id, ...item.data() } as Event))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    }, showError);
  }, [selectedId, user?.uid, profile?.active]);
  useEffect(() => {
    if (!showAllHistory || profile?.role === 'collaborator') { setAllEvents([]); return; }
    const byProject = new Map<string, Event[]>();
    const stops = projects.map(project => onSnapshot(collection(db, 'projects', project.id, 'events'), snap => {
      byProject.set(project.id, snap.docs.map(item => ({ id: item.id, ...item.data(), projectTitle: project.title } as Event)));
      setAllEvents([...byProject.values()].flat().sort((a, b) =>
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    }, showError));
    return () => stops.forEach(stop => stop());
  }, [showAllHistory, profile?.role, projects]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const time = Date.now();
      if (time - lastBackPress.current < 2000) { BackHandler.exitApp(); return true; }
      lastBackPress.current = time;
      if (!goBack() && Platform.OS === 'android') ToastAndroid.show('Toque em voltar novamente para sair', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, []);

  const current = projects.find(item => item.id === selectedId && (!item.archived || profile?.role !== 'collaborator'));
  const canManage = profile?.role === 'area_manager' || profile?.role === 'manager';
  const areaManagers = directory.filter(person => person.role === 'area_manager' || person.role === 'manager');
  const collaborators = directory.filter(person => person.role === 'collaborator');
  const selectedCollaborator = collaborators.find(person => person.id === responsibleCollaboratorId);
  const matchingCollaborators = collaboratorLookup.trim()
    ? collaborators.filter(person => String(person.employeeNumber ?? '').trim() === collaboratorLookup.trim()) : [];
  const possibleApprovers = areaManagers;
  const visible = projects.filter(item => canManage ? item.archived === showArchived : !item.archived);
  const scroller = (children: React.ReactNode) => <ScrollView style={{ flex: 1 }}
    contentContainerStyle={{ paddingHorizontal: width < 360 ? 14 : 20, paddingTop: 20, paddingBottom: 120 }}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>{children}</ScrollView>;

  async function login() {
    if (!email.trim() || !password) { Alert.alert('Campos obrigatórios', 'Informe e-mail e senha.'); return; }
    setBusy(true);
    try { await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password); setPassword(''); }
    catch (error) { showError(error); } finally { setBusy(false); }
  }
  async function logout() {
    setSelectedId(null); resetForm(); setCreating(false); setShowAllHistory(false); setShowArchived(false);
    try { await signOut(auth); } catch (error) { showError(error); }
  }
  async function createProject() {
    if (!user || !profile) return;
    const chosenCollaborator = collaborators.find(person => person.id === responsibleCollaboratorId);
    const costCents = parseMoney(cost), returnCents = parseMoney(expectedReturn);
    const missing = [['Título', title], ['Descrição', description],
      ['Origem da estimativa', estimateNotes]].find(([, value]) => !value.trim());
    if (missing) { Alert.alert('Falta preencher', `Informe: ${missing[0]}.`); return; }
    if (!chosenCollaborator?.department || !chosenCollaborator.name.trim()) {
      Alert.alert('Escolha um colaborador', 'Busque e selecione um colaborador ativo pela matrícula. Se ele não aparecer, peça à TI para conferir o cadastro.'); return;
    }
    if (costCents === null || costCents <= 0) { Alert.alert('Confira o custo', 'Digite o custo em reais, só com números e maior que zero.'); return; }
    if (returnCents === null) { Alert.alert('Confira o retorno', 'Digite o retorno esperado em reais. Para nenhum retorno, digite 0.'); return; }
    setBusy(true);
    try {
      const projectRef = doc(collection(db, 'projects'));
      const eventRef = doc(collection(projectRef, 'events'));
      const batch = writeBatch(db);
      batch.set(projectRef, {
        title: title.trim(), description: description.trim(), area: chosenCollaborator.department, ownerName: chosenCollaborator.name,
        authorId: user.uid, authorName: profile.name, status: 'pending', archived: false,
        responsibleCollaboratorId, approverIds: [], approvalStates: {}, costCents, returnCents,
        returnPeriod, estimateNotes: estimateNotes.trim(),
        nonCompletionReason: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastActionId: eventRef.id,
      });
      batch.set(eventRef, { type: 'created', actorId: user.uid, actorName: profile.name, detail: '', createdAt: serverTimestamp() });
      await batch.commit();
      resetForm(); setCreating(false);
      Alert.alert('Proposta enviada', 'Um gestor escolherá quem deve aprovar.');
    } catch (error) { showError(error); } finally { setBusy(false); }
  }
  async function startReview() {
    if (!user || !profile || !current || !canManage || current.status !== 'pending') return;
    if (chosenApprovers.length < 2 || chosenApprovers.length > 5) {
      Alert.alert('Escolha os gestores', 'Selecione de dois a cinco gestores aprovadores.'); return;
    }
    setBusy(true);
    try {
      const projectRef = doc(db, 'projects', current.id);
      const eventRef = doc(collection(projectRef, 'events'));
      const batch = writeBatch(db);
      batch.update(projectRef, {
        status: 'review', approverIds: chosenApprovers,
        approvalStates: Object.fromEntries(chosenApprovers.map(id => [id, 'pending'])),
        updatedAt: serverTimestamp(), lastActionId: eventRef.id,
      });
      batch.set(eventRef, { type: 'review_started', actorId: user.uid, actorName: profile.name,
        detail: chosenApprovers.map(id => directory.find(person => person.id === id)?.name || id).join(', '),
        createdAt: serverTimestamp() });
      await batch.commit(); setChosenApprovers([]);
    } catch (error) { showError(error); } finally { setBusy(false); }
  }
  async function approveAsManager() {
    if (!user || !profile || !current || !canManage || current.status !== 'review'
      || current.approvalStates[user.uid] !== 'pending') return;
    setBusy(true);
    try {
      const projectRef = doc(db, 'projects', current.id);
      const eventRef = doc(collection(projectRef, 'events'));
      await runTransaction(db, async transaction => {
        const latest = await transaction.get(projectRef);
        if (!latest.exists()) throw new Error('Proposta indisponível');
        const data = latest.data() as Project;
        if (data.status !== 'review' || data.approvalStates[user.uid] !== 'pending') throw new Error('Aprovação já registrada');
        const approvalStates = { ...data.approvalStates, [user.uid]: 'approved' };
        const allApproved = data.approverIds.every(id => approvalStates[id] === 'approved');
        transaction.update(projectRef, { approvalStates, status: allApproved ? 'in_progress' : 'review',
          updatedAt: serverTimestamp(), lastActionId: eventRef.id });
        transaction.set(eventRef, { type: 'manager_approved', actorId: user.uid, actorName: profile.name,
          detail: '', createdAt: serverTimestamp() });
      });
    } catch (error) { showError(error); } finally { setBusy(false); }
  }
  async function decision(type: 'rejected' | 'in_progress' | 'completed' | 'not_completed' | 'archived', detail = '') {
    if (!user || !profile || !current) return;
    if (type === 'completed' || type === 'archived' ? current.authorId !== user.uid : !canManage) return;
    setBusy(true);
    try {
      const projectRef = doc(db, 'projects', current.id);
      const eventRef = doc(collection(projectRef, 'events'));
      const batch = writeBatch(db);
      batch.update(projectRef, type === 'archived'
        ? { archived: true, updatedAt: serverTimestamp(), lastActionId: eventRef.id }
        : { status: type, nonCompletionReason: type === 'not_completed' ? detail : '',
            updatedAt: serverTimestamp(), lastActionId: eventRef.id });
      batch.set(eventRef, { type, actorId: user.uid, actorName: profile.name,
        detail, createdAt: serverTimestamp() });
      await batch.commit();
      if (type === 'archived') setSelectedId(null);
      if (type === 'not_completed') { setReason(''); setShowNoComplete(false); }
    } catch (error) { showError(error); } finally { setBusy(false); }
  }
  function archive() {
    Alert.alert('Excluir proposta?', 'Ela sairá da lista principal, mas permanecerá no histórico dos gestores.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: () => { void decision('archived'); } },
    ]);
  }
  async function addObservation() {
    if (!user || !profile || !current || !observation.trim()) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'projects', current.id, 'events'), {
        type: 'observation', actorId: user.uid, actorName: profile.name,
        detail: observation.trim(), createdAt: serverTimestamp(),
      });
      setObservation('');
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  if (loading) return <SafeAreaView style={s.center}><ActivityIndicator color={BLUE} /></SafeAreaView>;
  return <SafeAreaView style={s.screen}>
    <StatusBar style="light" />
    <LinearGradient colors={[BLUE, '#419978', GREEN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.header}>
      <Text style={s.brand}>SUA EMPRESA</Text><Text style={s.headerSub}>Ideias que viram ação.</Text>
    </LinearGradient>
    {user && <View style={s.topBar}>
      {(selectedId || creating || showAllHistory || showArchived) && <Pressable onPress={goBack}><Text style={s.link}>‹ Voltar</Text></Pressable>}
      <Text style={s.meta}>{profile?.active ? `Olá, ${profile.name.split(' ')[0]}` : 'Acesso pendente'}</Text>
      <Pressable onPress={logout}><Text style={s.link}>Sair</Text></Pressable>
    </View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {!user ? scroller(<>
        <Text style={s.heading}>Entrar</Text>
        <Text style={s.sub}>Use sua conta autorizada pela empresa.</Text>
        <Text style={s.label}>E-MAIL</Text><TextInput style={s.input} value={email} onChangeText={setEmail}
          keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Text style={[s.label, { marginTop: 14 }]}>SENHA</Text><TextInput style={s.input} value={password} onChangeText={setPassword}
          secureTextEntry={!showPassword} autoCapitalize="none" autoComplete="password" />
        <Pressable onPress={() => setShowPassword(!showPassword)}><Text style={s.link}>{showPassword ? 'Ocultar senha' : 'Mostrar senha'}</Text></Pressable>
        <Button title={busy ? 'Entrando...' : 'Entrar'} onPress={login} disabled={busy} />
        <Button title="Sair do aplicativo" outline onPress={() => Platform.OS === 'android' ? BackHandler.exitApp() : Alert.alert('Feche esta janela para sair.')} />
      </>) : !profile?.active ? scroller(<>
        <Text style={s.heading}>Acesso não liberado</Text>
        <Text style={s.sub}>Sua conta não tem um perfil ativo neste projeto. Peça à TI para conferir seu cadastro.</Text>
      </>) : creating ? scroller(<>
        <Pressable onPress={goBack}><Text style={s.link}>‹ Voltar ao painel</Text></Pressable>
        <Text style={s.heading}>Nova proposta</Text>
        <Field label="Título da melhoria *" value={title} onChange={setTitle} maxLength={120} />
        <Field label="Descrição *" value={description} onChange={setDescription} multiline maxLength={4000} />
        <Text style={s.section}>Colaborador *</Text>
        <Field label="Matrícula do colaborador *" value={collaboratorLookup} onChange={value => { setCollaboratorLookup(value); setResponsibleCollaboratorId(''); }} />
        {collaborators.length === 0 && <Text style={s.sub}>A TI precisa cadastrar colaboradores ativos com matrícula para receber propostas.</Text>}
        {collaboratorLookup.trim() && matchingCollaborators.length === 0 && <Text style={s.sub}>Nenhum colaborador ativo encontrado com essa matrícula.</Text>}
        {matchingCollaborators.map(person => <Pressable key={person.id} onPress={() => setResponsibleCollaboratorId(person.id)}>
          <Text style={s.link}>{responsibleCollaboratorId === person.id ? '☑' : '☐'} {person.name} · {person.department}</Text>
        </Pressable>)}
        {selectedCollaborator && <Text style={s.sub}>Responsável pelo projeto: {selectedCollaborator.name} · {selectedCollaborator.department}</Text>}
        <Text style={s.section}>Estimativa financeira</Text>
        <Text style={s.sub}>Digite somente números, em reais e sem centavos. Exemplo: 1500 = R$ 1.500,00.</Text>
        <Field label="Custo de implantação (R$) *" value={cost} onChange={setCost} maxLength={10} numeric />
        <Field label="Retorno esperado (R$) *" value={expectedReturn} onChange={setExpectedReturn} maxLength={10} numeric />
        <Text style={s.label}>PERÍODO DO RETORNO *</Text>
        <Button title="Por mês" outline={returnPeriod !== 'month'} onPress={() => setReturnPeriod('month')} />
        <Button title="Por ano" outline={returnPeriod !== 'year'} onPress={() => setReturnPeriod('year')} />
        <Field label="De onde vêm as estimativas? *" value={estimateNotes} onChange={setEstimateNotes} multiline maxLength={2000} />
        <Button title={busy ? 'Enviando...' : 'Enviar proposta'} onPress={createProject} disabled={busy} />
      </>) : current ? scroller(<>
        <Pressable onPress={() => { setSelectedId(null); setShowHistory(false); setShowNoComplete(false); }}><Text style={s.link}>‹ Voltar ao painel</Text></Pressable>
        <Text style={s.heading}>{current.title}</Text><Text style={s.badge}>{statuses[current.status]}</Text>
        {current.archived && <Text style={s.notice}>Proposta excluída · histórico preservado</Text>}
        <Text style={s.label}>SETOR</Text><Text style={s.value}>{current.area}</Text>
        <Text style={s.label}>RESPONSÁVEL</Text><Text style={s.value}>{current.ownerName}</Text>
        <Text style={s.label}>AUTOR</Text><Text style={s.value}>{current.authorName}</Text>
        <Text style={s.label}>PROPOSTA</Text><Text style={s.value}>{current.description}</Text>
        <View style={s.card}><Text style={s.cardTitle}>Estimativa financeira</Text>
          <Text style={s.value}>Custo de implantação: {formatMoney(current.costCents)}</Text>
          <Text style={s.value}>Retorno previsto: {formatMoney(current.returnPeriod === 'month' ? current.returnCents : Math.round(current.returnCents / 12))} por mês</Text>
          <Text style={s.value}>Equivalente anual: {formatMoney(current.returnPeriod === 'year' ? current.returnCents : current.returnCents * 12)}</Text>
          <Text style={s.sub}>Base da estimativa: {current.estimateNotes}</Text>
        </View>
        <Text style={s.section}>Aprovações</Text>
        {current.approverIds.length === 0 && <Text style={s.sub}>Um gestor ainda vai escolher os aprovadores.</Text>}
        {current.approverIds.map(id => <Text key={id} style={s.value}>{directory.find(person => person.id === id)?.name || 'Gestor'}: {current.approvalStates[id] === 'approved' ? 'aprovou' : 'aguardando aprovação'}</Text>)}
        {canManage && current.status === 'pending' && !current.archived && <View style={s.card}>
          <Text style={s.cardTitle}>Definir gestores aprovadores</Text><Text style={s.sub}>Selecione de dois a cinco gestores.</Text>
          <Field label="Buscar por matrícula" value={approverLookup} onChange={setApproverLookup} />
          {approverLookup.trim() && possibleApprovers.filter(person => person.employeeNumber === approverLookup.trim()).map(person => <Pressable key={person.id} onPress={() => setChosenApprovers(ids => ids.includes(person.id)
            ? ids.filter(id => id !== person.id) : [...ids, person.id])}><Text style={s.link}>{chosenApprovers.includes(person.id) ? '☑' : '☐'} {person.name} · {person.department}</Text></Pressable>)}
          {chosenApprovers.map(id => <Text key={id} style={s.sub}>✓ {directory.find(person => person.id === id)?.name}</Text>)}
          <Button title="Enviar para aprovação" onPress={() => { void startReview(); }} disabled={busy} />
        </View>}
        {canManage && current.status === 'review' && current.approvalStates[user.uid] === 'pending'
          && <><Text style={s.sub}>Você pode aprovar sem publicar comentário.</Text><Button title="Registrar minha aprovação" onPress={() => { void approveAsManager(); }} disabled={busy} /></>}
        {current.status === 'not_completed' && <View style={s.notice}>
          <Text style={s.cardTitle}>Motivo da não conclusão</Text>
          <Text style={s.value}>{current.nonCompletionReason}</Text>
          <Text style={s.sub}>Você pode acrescentar uma observação abaixo.</Text>
        </View>}
        {canManage && !current.archived && <View style={s.card}>
          <Text style={s.cardTitle}>Ações dos gestores</Text>
          {current.status === 'pending' && <Button title="Não aprovar" onPress={() => { void decision('rejected'); }} outline disabled={busy} />}
          {current.status === 'approved' && <Button title="Iniciar execução" onPress={() => { void decision('in_progress'); }} disabled={busy} />}
          {['approved', 'in_progress'].includes(current.status) && <><Button title="Não concluir proposta" onPress={() => setShowNoComplete(true)} outline />
            {showNoComplete && <><Field label="Motivo obrigatório *" value={reason} onChange={setReason} multiline maxLength={2000} />
              <Button title="Confirmar não conclusão" onPress={() => { if (!reason.trim()) Alert.alert('Motivo obrigatório', 'Informe por que a proposta não será concluída.'); else void decision('not_completed', reason.trim()); }} disabled={busy} /></>}
          </>}
          {['rejected', 'completed', 'not_completed'].includes(current.status) && <Text style={s.value}>Esta proposta está encerrada.</Text>}
        </View>}
        {current.authorId === user.uid && !current.archived
          && <Button title="Excluir minha proposta" onPress={archive} danger disabled={busy} />}
        {current.status === 'in_progress' && current.authorId === user.uid && !current.archived
          && <Button title="Concluir proposta" onPress={() => { void decision('completed'); }} disabled={busy} />}
        <Text style={s.section}>Observações</Text>
        {events.filter(event => event.type === 'observation').length === 0 && <Text style={s.sub}>Nenhuma observação ainda.</Text>}
        {events.filter(event => event.type === 'observation').map(event => <View key={event.id} style={s.card}>
          <Text style={s.cardTitle}>{event.actorName}</Text><Text style={s.value}>{event.detail}</Text><Text style={s.meta}>{displayDate(event.createdAt)}</Text>
        </View>)}
        {!current.archived && <><Field label="Nova observação" value={observation} onChange={setObservation} multiline maxLength={2000} />
          <Button title="Adicionar observação" onPress={() => { void addObservation(); }} disabled={busy || !observation.trim()} /></>}
        <Pressable onPress={() => setShowHistory(!showHistory)}><Text style={s.link}>Histórico da proposta {showHistory ? '▴' : '▾'}</Text></Pressable>
        {showHistory && events.map(event => <View key={event.id} style={s.historyItem}>
          <Text style={s.cardTitle}>{actions[event.type]}</Text>
          <Text style={s.meta}>{event.actorName} · {displayDate(event.createdAt)}</Text>
          {event.detail && <Text style={s.value}>{event.detail}</Text>}
        </View>)}
      </>) : scroller(<>
        <Text style={s.heading}>Painel de melhorias</Text><Text style={s.sub}>Propostas e andamento da fábrica.</Text>
        <Button title="+ Propor melhoria" onPress={() => { resetForm(); setCreating(true); }} />
        {canManage && <Button title={showArchived ? 'Ver propostas ativas' : 'Ver propostas excluídas'}
          onPress={() => setShowArchived(!showArchived)} outline />}
        {canManage && <Button title={showAllHistory ? 'Ocultar histórico geral' : 'Ver histórico geral'}
          onPress={() => setShowAllHistory(!showAllHistory)} outline />}
        {showAllHistory && canManage && <>
          <Text style={s.section}>Histórico geral</Text>
          {allEvents.length === 0 && <Text style={s.sub}>Nenhuma ação registrada.</Text>}
          {allEvents.map(event => <View key={`${event.projectTitle}-${event.id}`} style={s.historyItem}>
            <Text style={s.cardTitle}>{actions[event.type]}</Text><Text style={s.sub}>{event.projectTitle}</Text>
            <Text style={s.meta}>{event.actorName} · {displayDate(event.createdAt)}</Text>
            {event.detail && <Text style={s.value}>{event.detail}</Text>}
          </View>)}
        </>}
        <View style={s.card}><Text style={s.cardTitle}>Andamento das propostas</Text>
          {[
            { name: 'Aguardando', count: projects.filter(item => !item.archived && ['pending', 'review'].includes(item.status)).length, color: '#D19B35' },
            { name: 'Em andamento', count: projects.filter(item => !item.archived && item.status === 'in_progress').length, color: BLUE },
            { name: 'Finalizadas', count: projects.filter(item => !item.archived && item.status === 'completed').length, color: GREEN },
            { name: 'Não concluídas', count: projects.filter(item => !item.archived && ['not_completed', 'rejected'].includes(item.status)).length, color: '#A75656' },
          ].map(item => <View key={item.name} style={{ marginTop: 10 }}>
            <Text style={s.value}>{item.name} · {item.count}</Text>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: '#E6EDF0', overflow: 'hidden' }}>
              <View style={{ height: 10, width: `${projects.filter(project => !project.archived).length ? Math.round(item.count / projects.filter(project => !project.archived).length * 100) : 0}%`, backgroundColor: item.color }} />
            </View>
          </View>)}
        </View>
        <Text style={s.section}>{showArchived && canManage ? 'Propostas excluídas' : 'Propostas da fábrica'}</Text>
        {visible.length === 0 && <Text style={s.sub}>Nenhuma proposta nesta lista.</Text>}
        {visible.map(project => <Pressable key={project.id} style={s.card} onPress={() => { setSelectedId(project.id); setShowHistory(false); }}>
          <Text style={s.cardTitle}>{project.title}</Text><Text style={s.sub}>{project.area} · {project.ownerName}</Text>
          <Text style={s.badge}>{statuses[project.status]}</Text>
          <Text style={s.meta}>{displayDate(project.createdAt)} · {project.authorName}</Text>
        </Pressable>)}
      </>)}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F8F7' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingVertical: 24 }, brand: { color: 'white', fontSize: 24, fontWeight: '900' },
  headerSub: { color: 'white', fontSize: 14, marginTop: 4 },
  topBar: { backgroundColor: '#E5F1EC', paddingHorizontal: 18, paddingVertical: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heading: { color: INK, fontSize: 24, fontWeight: '800', marginTop: 8, marginBottom: 8 },
  sub: { color: MUTED, fontSize: 14, lineHeight: 20, marginBottom: 10 }, section: { color: INK, fontSize: 19, fontWeight: '800', marginVertical: 16 },
  card: { backgroundColor: 'white', borderColor: '#DCEAE7', borderWidth: 1, borderRadius: 15, padding: 16, marginBottom: 12 },
  cardTitle: { color: INK, fontWeight: '800', fontSize: 16, marginBottom: 5 },
  historyItem: { backgroundColor: '#EAF3F1', borderRadius: 10, padding: 13, marginBottom: 8 },
  badge: { color: '#286637', backgroundColor: '#EAF5E2', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 7, overflow: 'hidden', fontSize: 12, fontWeight: '800', marginVertical: 7 },
  meta: { color: MUTED, fontSize: 12, marginTop: 5 }, label: { color: MUTED, fontWeight: '700', fontSize: 12, marginBottom: 6 },
  value: { color: INK, lineHeight: 22, marginBottom: 16 }, field: { marginBottom: 12 },
  input: { backgroundColor: 'white', color: INK, borderWidth: 1, borderColor: '#DCE0E5', borderRadius: 9, padding: 12, fontSize: 16 },
  multiline: { minHeight: 95, textAlignVertical: 'top' },
  button: { backgroundColor: BLUE, borderRadius: 9, padding: 15, alignItems: 'center', marginTop: 8, marginBottom: 8 },
  outline: { backgroundColor: 'white', borderColor: BLUE, borderWidth: 1 },
  danger: { backgroundColor: '#FFF6F6', borderColor: '#D8868B', borderWidth: 1 }, disabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  link: { color: BLUE, fontWeight: '700', paddingVertical: 10 },
  notice: { backgroundColor: '#FFF6E7', padding: 10, borderRadius: 8, marginVertical: 10 },
});

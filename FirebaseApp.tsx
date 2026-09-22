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
type Profile = { name: string; email: string; role: Role; department: string; active: boolean };
type DirectoryPerson = Profile & { id: string };
type Status = 'pending' | 'review' | 'approved' | 'rejected' | 'in_progress' | 'completed' | 'not_completed';
type Project = {
  id: string; title: string; description: string; area: string; ownerName: string;
  authorId: string; authorName: string; status: Status; archived: boolean;
  areaManagerId: string; approverIds: string[]; approvalStates: Record<string, 'pending' | 'approved'>;
  costCents: number; returnCents: number; returnPeriod: 'month' | 'year'; estimateNotes: string;
  nonCompletionReason: string; createdAt?: Timestamp; updatedAt?: Timestamp; lastActionId: string;
};
type EventType = 'created' | 'review_started' | 'manager_approved' | 'rejected' | 'in_progress' | 'completed' | 'not_completed' | 'archived' | 'observation';
type Event = { id: string; type: EventType; actorId: string; actorName: string; detail: string; createdAt?: Timestamp; projectTitle?: string };

const BLUE = '#2279A9', GREEN = '#78B32F', INK = '#173348', MUTED = '#5E7280';
const statuses: Record<Status, string> = {
  pending: 'Aguardando gestor da área', review: 'Aguardando gestores', approved: 'Aprovada por todos', rejected: 'Não aprovada',
  in_progress: 'Em andamento', completed: 'Concluída', not_completed: 'Não concluída',
};
const actions: Record<EventType, string> = {
  created: 'Proposta criada', review_started: 'Gestores definidos', manager_approved: 'Aprovação registrada', rejected: 'Proposta não aprovada',
  in_progress: 'Execução iniciada', completed: 'Proposta concluída',
  not_completed: 'Proposta não concluída', archived: 'Proposta excluída', observation: 'Observação adicionada',
};
const formatMoney = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function parseMoney(value: string) {
  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : null;
}
function displayDate(value?: Timestamp) {
  return value?.toDate ? value.toDate().toLocaleString('pt-BR') : 'Sincronizando...';
}
function showError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const message = code === 'permission-denied' ? 'Você não tem permissão para esta ação. Peça ajuda à TI.'
    : code === 'auth/invalid-credential' ? 'E-mail ou senha incorretos.'
    : code === 'auth/too-many-requests' ? 'Muitas tentativas. Aguarde um pouco e tente novamente.'
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
    <TextInput style={[s.input, multiline && s.multiline]} value={value} onChangeText={onChange}
      keyboardType={numeric ? 'decimal-pad' : 'default'}
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
  const [area, setArea] = useState('');
  const [areaManagerId, setAreaManagerId] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [cost, setCost] = useState('');
  const [expectedReturn, setExpectedReturn] = useState('');
  const [returnPeriod, setReturnPeriod] = useState<'month' | 'year'>('month');
  const [estimateNotes, setEstimateNotes] = useState('');
  const [chosenApprovers, setChosenApprovers] = useState<string[]>([]);
  const [observation, setObservation] = useState('');
  const [reason, setReason] = useState('');
  const lastBackPress = useRef(0);

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
    const listQuery = profile.role === 'area_manager' ? query(base) : query(base, where('archived', '==', false));
    return onSnapshot(listQuery, snap => {
      setProjects(snap.docs.map(item => ({ id: item.id, ...item.data() } as Project))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)));
    }, showError);
  }, [user?.uid, profile?.active, profile?.role]);
  useEffect(() => {
    if (!user || !profile?.active) { setDirectory([]); return; }
    return onSnapshot(collection(db, 'users'), snap => {
      setDirectory(snap.docs.map(item => ({ id: item.id, ...item.data() } as DirectoryPerson))
        .filter(person => person.active && (person.role === 'area_manager' || person.role === 'manager')));
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
    if (!showAllHistory || profile?.role !== 'area_manager') { setAllEvents([]); return; }
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
      setSelectedId(null); setCreating(false); setShowHistory(false); setShowNoComplete(false);
      if (Platform.OS === 'android') ToastAndroid.show('Toque em voltar novamente para sair', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, []);

  const current = projects.find(item => item.id === selectedId && (!item.archived || profile?.role === 'area_manager'));
  const areaManagers = directory.filter(person => person.role === 'area_manager');
  const possibleApprovers = directory.filter(person => person.role === 'manager' && person.id !== current?.areaManagerId);
  const isAreaManager = current?.areaManagerId === user?.uid && profile?.role === 'area_manager';
  const visible = projects.filter(item => profile?.role === 'area_manager' ? item.archived === showArchived : !item.archived);
  const scroller = (children: React.ReactNode) => <ScrollView style={{ flex: 1 }}
    contentContainerStyle={{ padding: width < 360 ? 14 : 20, paddingBottom: 60 }}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>{children}</ScrollView>;

  async function login() {
    if (!email.trim() || !password) { Alert.alert('Campos obrigatórios', 'Informe e-mail e senha.'); return; }
    setBusy(true);
    try { await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password); setPassword(''); }
    catch (error) { showError(error); } finally { setBusy(false); }
  }
  async function logout() {
    setSelectedId(null); setCreating(false); setShowAllHistory(false); setShowArchived(false);
    try { await signOut(auth); } catch (error) { showError(error); }
  }
  async function createProject() {
    if (!user || !profile) return;
    const chosenAreaManager = areaManagers.find(person => person.id === areaManagerId);
    const costCents = parseMoney(cost), returnCents = parseMoney(expectedReturn);
    if (![title, description, ownerName, estimateNotes].every(value => value.trim()) || !chosenAreaManager?.department
      || costCents === null || costCents <= 0 || returnCents === null) {
      Alert.alert('Campos obrigatórios', 'Preencha todos os campos da proposta.'); return;
    }
    setBusy(true);
    try {
      const projectRef = doc(collection(db, 'projects'));
      const eventRef = doc(collection(projectRef, 'events'));
      const batch = writeBatch(db);
      batch.set(projectRef, {
        title: title.trim(), description: description.trim(), area: chosenAreaManager.department, ownerName: ownerName.trim(),
        authorId: user.uid, authorName: profile.name, status: 'pending', archived: false,
        areaManagerId, approverIds: [], approvalStates: {}, costCents, returnCents,
        returnPeriod, estimateNotes: estimateNotes.trim(),
        nonCompletionReason: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastActionId: eventRef.id,
      });
      batch.set(eventRef, { type: 'created', actorId: user.uid, actorName: profile.name, detail: '', createdAt: serverTimestamp() });
      await batch.commit();
      setTitle(''); setDescription(''); setArea(''); setAreaManagerId(''); setOwnerName(''); setCost('');
      setExpectedReturn(''); setEstimateNotes(''); setCreating(false);
      Alert.alert('Proposta enviada', 'O gestor da área escolherá quem deve aprovar.');
    } catch (error) { showError(error); } finally { setBusy(false); }
  }
  async function startReview() {
    if (!user || !profile || !current || !isAreaManager || current.status !== 'pending') return;
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
    if (!user || !profile || !current || profile.role !== 'manager' || current.status !== 'review'
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
        transaction.update(projectRef, { approvalStates, status: allApproved ? 'approved' : 'review',
          updatedAt: serverTimestamp(), lastActionId: eventRef.id });
        transaction.set(eventRef, { type: 'manager_approved', actorId: user.uid, actorName: profile.name,
          detail: '', createdAt: serverTimestamp() });
      });
    } catch (error) { showError(error); } finally { setBusy(false); }
  }
  async function decision(type: 'rejected' | 'in_progress' | 'completed' | 'not_completed' | 'archived', detail = '') {
    if (!user || !profile || !current || !isAreaManager) return;
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
    Alert.alert('Excluir proposta?', 'Ela sairá da lista principal, mas permanecerá no histórico dos gestores da área.', [
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
      <Text style={s.brand}>SUA EMPRESA</Text><Text style={s.headerSub}>Ideias que movem a operação</Text>
    </LinearGradient>
    {user && <View style={s.topBar}>
      <Text style={s.meta}>{profile?.active ? `Olá, ${profile.name.split(' ')[0]}` : 'Acesso pendente'}</Text>
      <Pressable onPress={logout}><Text style={s.link}>Sair</Text></Pressable>
    </View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {!user ? scroller(<>
        <Text style={s.heading}>Entrar</Text><Text style={s.sub}>Use sua conta autorizada pela empresa.</Text>
        <Text style={s.label}>E-MAIL</Text><TextInput style={s.input} value={email} onChangeText={setEmail}
          keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Text style={[s.label, { marginTop: 14 }]}>SENHA</Text><TextInput style={s.input} value={password} onChangeText={setPassword}
          secureTextEntry={!showPassword} autoCapitalize="none" autoComplete="password" />
        <Pressable onPress={() => setShowPassword(!showPassword)}><Text style={s.link}>{showPassword ? 'Ocultar senha' : 'Mostrar senha'}</Text></Pressable>
        <Button title={busy ? 'Entrando...' : 'Entrar'} onPress={login} disabled={busy} />
      </>) : !profile?.active ? scroller(<>
        <Text style={s.heading}>Acesso não liberado</Text>
        <Text style={s.sub}>Sua conta não tem um perfil ativo neste projeto. Peça à TI para conferir seu cadastro.</Text>
      </>) : creating ? scroller(<>
        <Pressable onPress={() => setCreating(false)}><Text style={s.link}>‹ Voltar ao painel</Text></Pressable>
        <Text style={s.heading}>Nova proposta</Text>
        <Field label="Título da melhoria *" value={title} onChange={setTitle} maxLength={120} />
        <Field label="Descrição *" value={description} onChange={setDescription} multiline maxLength={4000} />
        <Text style={s.section}>Gestor responsável pela área *</Text>
        {areaManagers.length === 0 && <Text style={s.sub}>A TI precisa cadastrar um gestor de área ativo para receber propostas.</Text>}
        {areaManagers.map(person => <Pressable key={person.id} onPress={() => { setAreaManagerId(person.id); setArea(person.department); }}>
          <Text style={s.link}>{areaManagerId === person.id ? '☑' : '☐'} {person.name} · {person.department}</Text>
        </Pressable>)}
        <Field label="Responsável pelo projeto *" value={ownerName} onChange={setOwnerName} maxLength={120} />
        <Text style={s.section}>Estimativa financeira</Text>
        <Field label="Custo de implantação (R$) *" value={cost} onChange={setCost} maxLength={20} numeric />
        <Field label="Retorno esperado (R$) *" value={expectedReturn} onChange={setExpectedReturn} maxLength={20} numeric />
        <Text style={s.label}>PERÍODO DO RETORNO *</Text>
        <Button title="Por mês" outline={returnPeriod !== 'month'} onPress={() => setReturnPeriod('month')} />
        <Button title="Por ano" outline={returnPeriod !== 'year'} onPress={() => setReturnPeriod('year')} />
        <Field label="De onde vêm as estimativas? *" value={estimateNotes} onChange={setEstimateNotes} multiline maxLength={2000} />
        <Button title={busy ? 'Enviando...' : 'Enviar para aprovação'} onPress={createProject} disabled={busy} />
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
        {current.approverIds.length === 0 && <Text style={s.sub}>O gestor da área ainda vai escolher os aprovadores.</Text>}
        {current.approverIds.map(id => <Text key={id} style={s.value}>{directory.find(person => person.id === id)?.name || 'Gestor'}: {current.approvalStates[id] === 'approved' ? 'aprovou' : 'aguardando aprovação'}</Text>)}
        {isAreaManager && current.status === 'pending' && !current.archived && <View style={s.card}>
          <Text style={s.cardTitle}>Definir gestores aprovadores</Text><Text style={s.sub}>Selecione de dois a cinco gestores.</Text>
          {possibleApprovers.map(person => <Pressable key={person.id} onPress={() => setChosenApprovers(ids => ids.includes(person.id)
            ? ids.filter(id => id !== person.id) : [...ids, person.id])}><Text style={s.link}>{chosenApprovers.includes(person.id) ? '☑' : '☐'} {person.name} · {person.department}</Text></Pressable>)}
          <Button title="Enviar para aprovação" onPress={() => { void startReview(); }} disabled={busy} />
        </View>}
        {profile.role === 'manager' && current.status === 'review' && current.approvalStates[user.uid] === 'pending'
          && <Button title="Registrar minha aprovação" onPress={() => { void approveAsManager(); }} disabled={busy} />}
        {current.status === 'not_completed' && <View style={s.notice}>
          <Text style={s.cardTitle}>Motivo da não conclusão</Text>
          <Text style={s.value}>{current.nonCompletionReason}</Text>
          <Text style={s.sub}>Você pode acrescentar uma observação abaixo.</Text>
        </View>}
        {isAreaManager && !current.archived && <View style={s.card}>
          <Text style={s.cardTitle}>Ações do gestor da área</Text>
          {current.status === 'pending' && <Button title="Não aprovar" onPress={() => { void decision('rejected'); }} outline disabled={busy} />}
          {current.status === 'approved' && <Button title="Iniciar execução" onPress={() => { void decision('in_progress'); }} disabled={busy} />}
          {current.status === 'in_progress' && <Button title="Concluir proposta" onPress={() => { void decision('completed'); }} disabled={busy} />}
          {['approved', 'in_progress'].includes(current.status) && <><Button title="Não concluir proposta" onPress={() => setShowNoComplete(true)} outline />
            {showNoComplete && <><Field label="Motivo obrigatório *" value={reason} onChange={setReason} multiline maxLength={2000} />
              <Button title="Confirmar não conclusão" onPress={() => { if (!reason.trim()) Alert.alert('Motivo obrigatório', 'Informe por que a proposta não será concluída.'); else void decision('not_completed', reason.trim()); }} disabled={busy} /></>}
          </>}
          {['rejected', 'completed', 'not_completed'].includes(current.status) && <Text style={s.value}>Esta proposta está encerrada.</Text>}
          <Button title="Excluir proposta" onPress={archive} danger disabled={busy} />
        </View>}
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
        <Button title="+ Propor melhoria" onPress={() => setCreating(true)} />
        {profile.role === 'area_manager' && <Button title={showArchived ? 'Ver propostas ativas' : 'Ver propostas excluídas'}
          onPress={() => setShowArchived(!showArchived)} outline />}
        {profile.role === 'area_manager' && <Button title={showAllHistory ? 'Ocultar histórico geral' : 'Ver histórico geral'}
          onPress={() => setShowAllHistory(!showAllHistory)} outline />}
        {showAllHistory && profile.role === 'area_manager' && <>
          <Text style={s.section}>Histórico geral</Text>
          {allEvents.length === 0 && <Text style={s.sub}>Nenhuma ação registrada.</Text>}
          {allEvents.map(event => <View key={`${event.projectTitle}-${event.id}`} style={s.historyItem}>
            <Text style={s.cardTitle}>{actions[event.type]}</Text><Text style={s.sub}>{event.projectTitle}</Text>
            <Text style={s.meta}>{event.actorName} · {displayDate(event.createdAt)}</Text>
            {event.detail && <Text style={s.value}>{event.detail}</Text>}
          </View>)}
        </>}
        <Text style={s.section}>{showArchived && profile.role === 'area_manager' ? 'Propostas excluídas' : 'Propostas da fábrica'}</Text>
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

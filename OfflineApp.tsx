import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, BackHandler, KeyboardAvoidingView, Platform, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, ToastAndroid, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';

type Role = 'colaborador' | 'gestor_area' | 'manutencao' | 'custos';
type Manager = Exclude<Role, 'colaborador'>;
type Status = 'pending' | 'review' | 'in_progress' | 'completed' | 'not_completed' | 'rejected';
type Approval = { manager: Manager; approvedAt: string | null };
type Project = {
  id: string; title: string; description: string; area: string; owner: string;
  author: Role; status: Status; reason: string; comments: string[];
  costCents: number; returnCents: number; returnPeriod: 'month' | 'year';
  estimateNotes: string; approvals: Approval[]; history: string[];
};
type Form = {
  title: string; description: string; area: string; owner: string;
  cost: string; expectedReturn: string; returnPeriod: 'month' | 'year'; estimateNotes: string;
};
const KEY = 'melhorias-offline-demo-v2';
const emptyForm = (): Form => ({ title: '', description: '', area: '', owner: '', cost: '', expectedReturn: '', returnPeriod: 'month', estimateNotes: '' });
const accounts: { id: Role; name: string; password: string }[] = [
  { id: 'colaborador', name: 'Colaborador', password: '000000' },
  { id: 'gestor_area', name: 'Gestor da área', password: '111111' },
  { id: 'manutencao', name: 'Gestor da manutenção', password: '222222' },
  { id: 'custos', name: 'Gestor de custos', password: '333333' },
];
const managers = accounts.filter((account): account is { id: Manager; name: string; password: string } => account.id !== 'colaborador');
const statuses: Record<Status, string> = {
  pending: 'Aguardando gestores', review: 'Aguardando aprovações', in_progress: 'Em andamento',
  completed: 'Concluída', not_completed: 'Não concluída', rejected: 'Não aprovada',
};
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const digits = (value: string) => value.replace(/\D/g, '').slice(0, 10);
const cents = (value: string) => Number(value) * 100;
const stamp = () => new Date().toLocaleString('pt-BR');

function Button({ text, onPress, outline = false, disabled = false }: { text: string; onPress: () => void; outline?: boolean; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.button, outline && s.outline, disabled && s.disabled]}>
    <Text style={[s.buttonText, outline && s.outlineText]}>{text}</Text>
  </Pressable>;
}
function Input({ value, onChange, placeholder, multi = false, numeric = false, secure = false }: {
  value: string; onChange: (value: string) => void; placeholder: string; multi?: boolean; numeric?: boolean; secure?: boolean;
}) {
  return <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#667784"
    keyboardType={numeric ? 'number-pad' : 'default'} multiline={multi} secureTextEntry={secure}
    style={[s.input, multi && s.multiline]} />;
}
function Header() {
  return <LinearGradient colors={['#2279A9', '#419978', '#78B32F']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.header}>
    <StatusBar style="light" /><Text style={s.brand}>SUA EMPRESA</Text><Text style={s.subWhite}>Fazer a vida fluir</Text>
  </LinearGradient>;
}

export default function OfflineApp() {
  const [role, setRole] = useState<Role | null>(null);
  const [loginRole, setLoginRole] = useState<Role | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [items, setItems] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [selected, setSelected] = useState<Project | null>(null);
  const [chosen, setChosen] = useState<Manager[]>([]);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const lastBack = useRef(0);
  const page = useRef({ loginRole, formOpen, selected });
  page.current = { loginRole, formOpen, selected };

  const closeForm = () => { setForm(emptyForm()); setFormOpen(false); };
  const back = () => {
    if (page.current.formOpen) { closeForm(); return true; }
    if (page.current.selected) { setSelected(null); setChosen([]); setComment(''); setReason(''); return true; }
    if (page.current.loginRole) { setLoginRole(null); setPassword(''); setShowPassword(false); return true; }
    return false;
  };
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      const now = Date.now();
      if (now - lastBack.current < 2000) { BackHandler.exitApp(); return true; }
      lastBack.current = now;
      if (!back()) ToastAndroid.show('Toque em voltar novamente para sair', ToastAndroid.SHORT);
      return true;
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(KEY).then(raw => setItems(raw ? JSON.parse(raw) as Project[] : []))
      .catch(() => Alert.alert('Não foi possível carregar os testes salvos neste aparelho.'))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { if (loaded) void AsyncStorage.setItem(KEY, JSON.stringify(items)); }, [items, loaded]);

  const screen = (children: React.ReactNode) => <SafeAreaView style={s.page}><Header />
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={s.fill} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>{children}</ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
  const update = (next: Project) => { setItems(current => current.map(item => item.id === next.id ? next : item)); setSelected(next); };
  const action = (project: Project, label: string, changes: Partial<Project>) => update({
    ...project, ...changes, history: [...project.history, `${stamp()} · ${accounts.find(account => account.id === role)?.name}: ${label}`],
  });
  const setField = (field: keyof Form, value: string) => setForm(current => ({ ...current, [field]: value }));
  const submit = () => {
    if (!role) return;
    const missing = [
      ['Título', form.title], ['Descrição', form.description], ['Setor / área', form.area],
      ['Responsável', form.owner], ['Origem da estimativa', form.estimateNotes],
    ].find(([, value]) => !value.trim());
    if (missing) return Alert.alert('Falta preencher', `Informe: ${missing[0]}.`);
    if (!form.cost || Number(form.cost) <= 0) return Alert.alert('Confira o custo', 'Digite o custo em reais, só com números e maior que zero.');
    if (!form.expectedReturn) return Alert.alert('Confira o retorno', 'Digite o retorno esperado em reais. Para nenhum retorno, digite 0.');
    setItems(current => [{
      id: `${Date.now()}-${Math.random()}`, title: form.title.trim(), description: form.description.trim(),
      area: form.area.trim(), owner: form.owner.trim(), author: role, status: 'pending', reason: '', comments: [],
      costCents: cents(form.cost), returnCents: cents(form.expectedReturn), returnPeriod: form.returnPeriod,
      estimateNotes: form.estimateNotes.trim(), approvals: [], history: [`${stamp()} · Proposta criada`],
    }, ...current]);
    closeForm();
    Alert.alert('Proposta enviada', 'Agora um gestor poderá escolher os aprovadores.');
  };

  if (!role && !loginRole) return screen(<>
    <Text style={s.title}>Quem vai acessar?</Text><Text style={s.copy}>Escolha um perfil de demonstração. Nenhuma informação é enviada para a empresa.</Text>
    <View style={s.notice}><Text style={s.noticeText}>TESTE OFFLINE · Os dados ficam somente neste aparelho.</Text></View>
    {accounts.map(account => <Button key={account.id} text={account.name} outline onPress={() => setLoginRole(account.id)} />)}
  </>);
  if (!role && loginRole) return screen(<>
    <Pressable onPress={back}><Text style={s.link}>‹ Voltar aos perfis</Text></Pressable>
    <Text style={s.title}>{accounts.find(account => account.id === loginRole)?.name}</Text>
    <Text style={s.copy}>Teste offline. Digite a senha de demonstração deste perfil.</Text>
    <Text style={s.copy}>Senha para teste: {accounts.find(account => account.id === loginRole)?.password}</Text>
    <Input value={password} onChange={value => setPassword(digits(value).slice(0, 6))} placeholder="Senha de 6 números" numeric secure={!showPassword} />
    <Pressable onPress={() => setShowPassword(current => !current)}><Text style={s.link}>{showPassword ? 'Ocultar senha' : 'Mostrar senha'}</Text></Pressable>
    <Button text="Entrar" onPress={() => {
      const account = accounts.find(item => item.id === loginRole);
      if (password !== account?.password) return Alert.alert('Senha incorreta', 'Confira a senha deste perfil no README.');
      setRole(loginRole); setLoginRole(null); setPassword(''); setShowPassword(false);
    }} />
  </>);
  if (formOpen) return screen(<>
    <Pressable onPress={back}><Text style={s.link}>‹ Voltar ao painel</Text></Pressable>
    <View style={s.notice}><Text style={s.noticeText}>TESTE OFFLINE · Esta proposta não será enviada pela internet.</Text></View>
    <Text style={s.title}>Nova proposta</Text>
    <Input value={form.title} onChange={value => setField('title', value)} placeholder="Título" />
    <Input value={form.description} onChange={value => setField('description', value)} placeholder="Descrição" multi />
    <Input value={form.area} onChange={value => setField('area', value)} placeholder="Setor / área" />
    <Input value={form.owner} onChange={value => setField('owner', value)} placeholder="Responsável" />
    <Text style={s.section}>Estimativa financeira</Text>
    <Text style={s.copy}>Digite somente números, em reais e sem centavos. Exemplo: 1500 = R$ 1.500,00.</Text>
    <Input value={form.cost} onChange={value => setField('cost', digits(value))} placeholder="Custo de implantação em R$" numeric />
    <Input value={form.expectedReturn} onChange={value => setField('expectedReturn', digits(value))} placeholder="Retorno esperado em R$" numeric />
    <Text style={s.copy}>O retorno informado será {form.returnPeriod === 'month' ? 'por mês' : 'por ano'}.</Text>
    <Button text="Por mês" outline={form.returnPeriod !== 'month'} onPress={() => setField('returnPeriod', 'month')} />
    <Button text="Por ano" outline={form.returnPeriod !== 'year'} onPress={() => setField('returnPeriod', 'year')} />
    <Input value={form.estimateNotes} onChange={value => setField('estimateNotes', value)} placeholder="Explique de onde vêm as estimativas" multi />
    <Button text="Enviar proposta" onPress={submit} />
  </>);

  if (selected) {
    const monthly = selected.returnPeriod === 'month' ? selected.returnCents : Math.round(selected.returnCents / 12);
    const annual = selected.returnPeriod === 'year' ? selected.returnCents : selected.returnCents * 12;
    const canManage = role !== 'colaborador';
    const pendingForMe = selected.approvals.some(approval => approval.manager === role && !approval.approvedAt);
    return screen(<>
      <Pressable onPress={back}><Text style={s.link}>‹ Voltar ao painel</Text></Pressable>
      <View style={s.notice}><Text style={s.noticeText}>TESTE OFFLINE · As decisões são apenas para demonstração.</Text></View>
      <Text style={s.title}>{selected.title}</Text><Text style={s.badge}>{statuses[selected.status]}</Text>
      <Text style={s.copy}>{selected.area} · Responsável: {selected.owner}</Text><Text style={s.copy}>{selected.description}</Text>
      <View style={s.card}><Text style={s.cardTitle}>Estimativa financeira</Text>
        <Text style={s.copy}>Custo: {money(selected.costCents)}</Text>
        <Text style={s.copy}>Retorno: {money(monthly)} por mês · {money(annual)} por ano</Text>
        <Text style={s.copy}>Origem: {selected.estimateNotes}</Text>
      </View>
      <Text style={s.section}>Aprovações</Text>
      {selected.approvals.length === 0 && <Text style={s.copy}>Um gestor ainda escolherá os aprovadores.</Text>}
      {selected.approvals.map(approval => <Text key={approval.manager} style={s.copy}>
        {accounts.find(account => account.id === approval.manager)?.name}: {approval.approvedAt ? `aprovou em ${approval.approvedAt}` : 'aguardando'}
      </Text>)}
      {canManage && selected.status === 'pending' && <View style={s.card}>
        <Text style={s.cardTitle}>Escolher gestores</Text><Text style={s.copy}>Selecione pelo menos dois.</Text>
        {managers.map(manager => <Pressable key={manager.id} onPress={() => setChosen(current => current.includes(manager.id)
          ? current.filter(id => id !== manager.id) : [...current, manager.id])}>
          <Text style={s.link}>{chosen.includes(manager.id) ? '☑' : '☐'} {manager.name}</Text>
        </Pressable>)}
        <Button text="Enviar para aprovação" onPress={() => {
          if (chosen.length < 2) return Alert.alert('Escolha pelo menos dois gestores.');
          action(selected, 'Aprovadores escolhidos', { status: 'review', approvals: chosen.map(manager => ({ manager, approvedAt: null })) });
          setChosen([]);
        }} />
      </View>}
      {canManage && pendingForMe && selected.status === 'review' && <><Text style={s.copy}>Você pode aprovar sem publicar comentário.</Text><Button text="Aprovar proposta" onPress={() => {
        const approvals = selected.approvals.map(approval => approval.manager === role
          ? { ...approval, approvedAt: stamp() } : approval);
        action(selected, 'Aprovação registrada', { approvals, status: approvals.every(approval => approval.approvedAt) ? 'in_progress' : 'review' });
      }} /></>}
      {selected.status === 'in_progress' && role === selected.author && <Button text="Concluir proposta" onPress={() => action(selected, 'Proposta concluída', { status: 'completed' })} />}
      {canManage && selected.status === 'in_progress' && <>
        <Input value={reason} onChange={setReason} placeholder="Motivo para não concluir" multi />
        <Button text="Não concluir" outline onPress={() => {
          if (!reason.trim()) return Alert.alert('Informe o motivo da não conclusão.');
          action(selected, `Não concluída: ${reason.trim()}`, { status: 'not_completed', reason: reason.trim() });
          setReason('');
        }} />
      </>}
      {selected.reason ? <Text style={s.reason}>Motivo: {selected.reason}</Text> : null}
      <Text style={s.section}>Comentários</Text>
      {selected.comments.map((entry, index) => <Text key={index} style={s.copy}>• {entry}</Text>)}
      <Input value={comment} onChange={setComment} placeholder="Adicionar comentário (opcional)" multi />
      <Button text="Publicar comentário" outline onPress={() => {
        if (!comment.trim()) return;
        action(selected, 'Comentário adicionado', { comments: [...selected.comments, `${accounts.find(account => account.id === role)?.name}: ${comment.trim()}`] });
        setComment('');
      }} />
      <Text style={s.section}>Histórico</Text>
      {selected.history.map((entry, index) => <Text key={index} style={s.copy}>{entry}</Text>)}
    </>);
  }

  const counts = [
    { title: 'Aguardando', count: items.filter(item => item.status === 'pending' || item.status === 'review').length, color: '#D19B35' },
    { title: 'Em andamento', count: items.filter(item => item.status === 'in_progress').length, color: '#2279A9' },
    { title: 'Finalizadas', count: items.filter(item => item.status === 'completed').length, color: '#78B32F' },
    { title: 'Não concluídas', count: items.filter(item => item.status === 'not_completed' || item.status === 'rejected').length, color: '#A75656' },
  ];
  return screen(<>
    <View style={s.top}><Text style={s.title}>Painel de melhorias</Text><Pressable onPress={() => { setRole(null); setSelected(null); closeForm(); }}><Text style={s.link}>Sair</Text></Pressable></View>
    <View style={s.notice}><Text style={s.noticeText}>TESTE OFFLINE · Cada aparelho tem seus próprios dados. Nada é sincronizado.</Text></View>
    <Button text="+ Propor melhoria" onPress={() => { setForm(emptyForm()); setFormOpen(true); }} />
    <View style={s.card}><Text style={s.cardTitle}>Andamento das propostas</Text>
      {counts.map(item => <View key={item.title} style={s.chartRow}>
        <Text style={s.chartLabel}>{item.title} · {item.count}</Text>
        <View style={s.track}><View style={[s.bar, { backgroundColor: item.color, width: `${items.length ? Math.round(item.count / items.length * 100) : 0}%` }]} /></View>
      </View>)}
    </View>
    {items.length === 0 ? <Text style={s.copy}>Nenhuma proposta criada neste aparelho. Comece um novo teste.</Text>
      : items.map(item => <Pressable style={s.card} key={item.id} onPress={() => setSelected(item)}>
        <Text style={s.cardTitle}>{item.title}</Text><Text style={s.badge}>{statuses[item.status]}</Text>
      </Pressable>)}
  </>);
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F3F8F7' }, fill: { flex: 1 },
  header: { padding: 22 }, brand: { color: 'white', fontSize: 21, fontWeight: '800' },
  subWhite: { color: 'white', marginTop: 4 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120, gap: 12, flexGrow: 1 },
  title: { color: '#173348', fontSize: 22, fontWeight: '800' },
  section: { color: '#173348', fontSize: 19, fontWeight: '800', marginTop: 8 },
  copy: { color: '#465F6E', lineHeight: 22 },
  input: { color: '#111111', borderWidth: 1, borderColor: '#BDC9CD', borderRadius: 9,
    backgroundColor: 'white', padding: 12, fontSize: 16 },
  multiline: { minHeight: 94, textAlignVertical: 'top' },
  button: { minHeight: 48, padding: 14, borderRadius: 9, backgroundColor: '#2279A9', alignItems: 'center', justifyContent: 'center' },
  outline: { backgroundColor: 'white', borderWidth: 1, borderColor: '#2279A9' },
  disabled: { opacity: 0.5 }, buttonText: { color: 'white', fontWeight: '800' }, outlineText: { color: '#2279A9' },
  link: { color: '#2279A9', fontWeight: '800', paddingVertical: 6 },
  card: { backgroundColor: 'white', borderRadius: 12, padding: 15, gap: 6 },
  cardTitle: { fontWeight: '800', color: '#173348', fontSize: 16 },
  badge: { color: '#286637', fontWeight: '700' },
  notice: { backgroundColor: '#E9F3E6', borderRadius: 9, padding: 12 },
  noticeText: { color: '#244D35', fontWeight: '700' },
  reason: { color: '#865A27', backgroundColor: '#FFF6E7', padding: 10, borderRadius: 8 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chartRow: { gap: 4, marginTop: 8 }, chartLabel: { color: '#173348' },
  track: { height: 10, borderRadius: 5, backgroundColor: '#E6EDF0', overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5 },
});

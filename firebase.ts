import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from '@firebase/auth';
import type { Persistence } from '@firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const useLocalEmulator = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR === 'true';
const companyConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
if (!useLocalEmulator && (!companyConfig.apiKey || !companyConfig.projectId || !companyConfig.appId)) {
  throw new Error('Firebase não configurado. Preencha as variáveis EXPO_PUBLIC_FIREBASE_* antes de gerar o app conectado.');
}
const config = useLocalEmulator ? {
  apiKey: 'demo-api-key',
  authDomain: 'demo-app-melhorias-local.firebaseapp.com',
  projectId: 'demo-app-melhorias-local',
  appId: '1:1234567890:web:demo-app-melhorias-local',
} : companyConfig;
const app = getApps().length ? getApp() : initializeApp(config);
let authInstance;
if (Platform.OS === 'web') {
  authInstance = firebaseAuth.getAuth(app);
} else {
  try {
    // No Android, o acesso continua salvo para a pessoa não precisar entrar toda vez.
    const getReactNativePersistence = (firebaseAuth as typeof firebaseAuth & {
      getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
    }).getReactNativePersistence;
    authInstance = firebaseAuth.initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/already-initialized') throw error;
    authInstance = firebaseAuth.getAuth(app);
  }
}
export const auth = authInstance;
export const db = getFirestore(app);
if (useLocalEmulator) {
  const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST
    || (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
  if (!auth.emulatorConfig) firebaseAuth.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}

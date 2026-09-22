import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as firebaseAuth from '@firebase/auth';
import type { Persistence } from '@firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
if (!config.apiKey || !config.projectId || !config.appId) {
  throw new Error('Firebase não configurado. Preencha as variáveis EXPO_PUBLIC_FIREBASE_* antes de gerar o app conectado.');
}
const app = getApps().length ? getApp() : initializeApp(config);
let authInstance;
try {
  // O export de persistência existe no pacote React Native, mas não na tipagem padrão do pacote.
  const getReactNativePersistence = (firebaseAuth as typeof firebaseAuth & {
    getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
  }).getReactNativePersistence;
  authInstance = firebaseAuth.initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch (error) {
  if ((error as { code?: string }).code !== 'auth/already-initialized') throw error;
  authInstance = firebaseAuth.getAuth(app);
}
export const auth = authInstance;
export const db = getFirestore(app);

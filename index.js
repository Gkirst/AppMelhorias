import { registerRootComponent } from 'expo';

const App = process.env.EXPO_PUBLIC_APP_MODE === 'offline'
  ? require('./OfflineApp').default
  : require('./FirebaseApp').default;

registerRootComponent(App);

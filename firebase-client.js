import { firebaseAppCheckSiteKey, firebaseConfig, firebaseFunctionsRegion, firebaseIsConfigured } from './firebase-config.js';

const unavailable = (reason = 'Firebase indisponível') => ({
  available: false,
  reason,
  user: null,
  call: async () => { throw new Error(reason); },
  signIn: async () => { throw new Error(reason); },
  signOut: async () => {},
  onAuthStateChanged: (listener) => { listener(null); return () => {}; }
});

let client = unavailable('Firebase não foi inicializado.');

function publishClient() {
  window.naBrasaFirebasePending = false;
  window.naBrasaFirebase = client;
  window.dispatchEvent(new CustomEvent('nabrasa-firebase-ready', { detail: client }));
}

try {
  if (!firebaseIsConfigured) {
    client = unavailable('Firebase ainda não foi configurado.');
  } else {
    const [appModule, authModule, functionsModule, appCheckModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js'),
      import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js')
    ]);
    const app = appModule.initializeApp(firebaseConfig);
    const auth = authModule.getAuth(app);
    const functions = functionsModule.getFunctions(app, firebaseFunctionsRegion);
    const appCheck = firebaseAppCheckSiteKey
      ? appCheckModule.initializeAppCheck(app, {
          provider: new appCheckModule.ReCaptchaV3Provider(firebaseAppCheckSiteKey),
          isTokenAutoRefreshEnabled: true
        })
      : null;

    client = {
      available: true,
      app,
      auth,
      functions,
      appCheck,
      appCheckConfigured: Boolean(appCheck),
      get user() { return auth.currentUser; },
      call: async (name, payload = {}) => {
        const response = await functionsModule.httpsCallable(functions, name)(payload);
        return response?.data || {};
      },
      signIn: (email, password) => authModule.signInWithEmailAndPassword(auth, email, password),
      signOut: () => authModule.signOut(auth),
      onAuthStateChanged: (listener) => authModule.onAuthStateChanged(auth, listener),
      getErrorCode: (error) => error?.code || ''
    };
  }
} catch (error) {
  console.warn('Firebase não pôde ser carregado; o checkout seguro ficará indisponível.', error);
  client = unavailable('Não foi possível conectar ao Firebase nesta página.');
}

publishClient();
export default client;

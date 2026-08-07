// Firebase web configuration is intentionally public. Security is enforced by
// Authentication, callable Cloud Functions, and Firestore Security Rules.
export const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyAbetQRoV2PuKYis0BGlUNSJ6FdE7IQmY0',
  authDomain: 'hamburgueria-ee939.firebaseapp.com',
  projectId: 'hamburgueria-ee939',
  storageBucket: 'hamburgueria-ee939.firebasestorage.app',
  messagingSenderId: '216249473871',
  appId: '1:216249473871:web:9a26955dd54cae459dc33a',
  measurementId: 'G-9KH86TDPBV'
});

// Keep this value aligned with the region used by the Cloud Functions.
// It can be overridden before this module loads for a future migration.
export const firebaseFunctionsRegion = window.NABRASA_FIREBASE_REGION || 'southamerica-east1';

// reCAPTCHA v3 site keys are public browser identifiers. Add the key after
// registering the production domain in Firebase App Check / reCAPTCHA.
export const firebaseAppCheckSiteKey = String(window.NABRASA_RECAPTCHA_SITE_KEY || '').trim();

export const firebaseIsConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId
);

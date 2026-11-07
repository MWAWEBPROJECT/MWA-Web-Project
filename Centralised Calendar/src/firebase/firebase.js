import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'firebase/app-check';
import { initializeApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { firebaseConfig, FUNCTIONS_REGION } from './firebaseConfig';

export const firebaseConfigured = !!firebaseConfig.apiKey && firebaseConfig.apiKey.length > 10;

const app = initializeApp(firebaseConfig);
const appCheckKey=import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
if(appCheckKey)initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(appCheckKey),isTokenAutoRefreshEnabled:true});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

setPersistence(auth, browserLocalPersistence).catch(() => {});

export default app;

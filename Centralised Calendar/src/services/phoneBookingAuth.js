import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'firebase/app-check';
import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth, inMemoryPersistence, RecaptchaVerifier, setPersistence,
  signInWithPhoneNumber, signOut
} from 'firebase/auth';
import { firebaseConfig } from '../firebase/firebaseConfig.js';

const APP_NAME = 'mwa-booking-phone-verification';
const existingApp=getApps().find(app=>app.name===APP_NAME);
const phoneApp=existingApp||initializeApp(firebaseConfig,APP_NAME);
if(!existingApp&&import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY)initializeAppCheck(phoneApp,{provider:new ReCaptchaEnterpriseProvider(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});
const phoneAuth = getAuth(phoneApp);
let verifier;
let persistenceReady;

async function ensurePhoneAuth() {
  if (!persistenceReady) persistenceReady = setPersistence(phoneAuth, inMemoryPersistence);
  await persistenceReady;
}

export function normalizeBookingPhone(value){
 let phone=String(value||'').trim().replace(/[ ()-]/g,'');
 if(/^04\d{8}$/.test(phone))phone='+61'+phone.slice(1);
 if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Enter a mobile number such as 0412 345 678 or +61 412 345 678.');
 return phone;
}
export async function sendBookingPhoneCode(phoneNumber) {
  phoneNumber=normalizeBookingPhone(phoneNumber);
  await ensurePhoneAuth();
  clearBookingPhoneRecaptcha();
  verifier = new RecaptchaVerifier(phoneAuth, 'booking-phone-recaptcha', { size: 'invisible' });
  try {
    return await signInWithPhoneNumber(phoneAuth, phoneNumber, verifier);
  } catch (error) {
    clearBookingPhoneRecaptcha();
    throw error;
  }
}

export async function confirmBookingPhoneCode(confirmation, code) {
  const result = await confirmation.confirm(code);
  const token = await result.user.getIdToken(true);
  await signOut(phoneAuth);
  clearBookingPhoneRecaptcha();
  return token;
}

export function clearBookingPhoneRecaptcha() {
  if (verifier) {
    verifier.clear();
    verifier = null;
  }
}

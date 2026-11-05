import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth, inMemoryPersistence, RecaptchaVerifier, setPersistence,
  signInWithPhoneNumber, signOut
} from 'firebase/auth';
import { firebaseConfig } from '../firebase/firebaseConfig.js';

const APP_NAME = 'mwa-booking-phone-verification';
const phoneApp = getApps().find(app => app.name === APP_NAME) || initializeApp(firebaseConfig, APP_NAME);
const phoneAuth = getAuth(phoneApp);
let verifier;
let persistenceReady;

async function ensurePhoneAuth() {
  if (!persistenceReady) persistenceReady = setPersistence(phoneAuth, inMemoryPersistence);
  await persistenceReady;
}

export async function sendBookingPhoneCode(phoneNumber) {
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

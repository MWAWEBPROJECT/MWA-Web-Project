import {permittedModules,accessActive} from '@mwa/access';
import {recordActivity} from '../services/auditService.js';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider, linkWithCredential, onAuthStateChanged, signInWithCredential,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, firebaseConfigured } from '../firebase/firebase';
import { syncAdminAccess } from '../services/adminTeamService';
import {createAdminSessionCheck,sessionIdentity} from '../utils/adminSessionCheck.mjs';

const AuthContext = createContext(null);

export const OWNER_EMAIL = 'admin@muhammadiwelfare.org.au';

const DENIED_MESSAGES = {
  'not-listed': 'This account is not on the MWA admin team list. Ask the Super Admin to add your email.',
  'unverified-email': 'This account’s email address is not verified. Use Sign in with Google instead.',
  'no-email': 'This account has no email address, so it cannot be checked against the admin list.',
  'password-disabled': 'Email/password sign-in has been turned off. Use Sign in with Google.'
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isResponseViewer,setResponseViewer]=useState(false);
  const [teamState,setTeamState]=useState({email:'',entry:null});
  const [clock,setClock]=useState(Date.now());
  const [profile, setProfile] = useState(null); // users/{uid} doc, has .role
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [authError, setAuthError] = useState('');
  const [passwordLoginDisabled, setPasswordLoginDisabled] = useState(false);
  // Google credential waiting to be linked to an existing email/password account with the same email.
  const [pendingLink, setPendingLink] = useState(null);
  const syncedUid = useRef(null);
  const linking = useRef(false);
  const hadSession = useRef(false);
  const sessionGeneration = useRef(0);
  const bootstrapCheck = useRef(null);
  if (!bootstrapCheck.current) bootstrapCheck.current = createAdminSessionCheck(() => auth.currentUser, syncAdminAccess);

  useEffect(() => {
    if (window.self !== window.top) return;
    const check = user => bootstrapCheck.current(user);
    window.mwaAdminAccessCheck = check;
    return () => { if (window.mwaAdminAccessCheck === check) delete window.mwaAdminAccessCheck; };
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) {
      setLoading(false);
      return;
    }
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      sessionGeneration.current++;
      const signedOut = hadSession.current && !u;
      setUser(u);setResponseViewer(false);setProfile(null);setLoading(!!u);setSyncing(false);
      if(signedOut){hadSession.current=false;window.top.location.replace("/");}
      if (!u) {
        bootstrapCheck.current.reset();
        syncedUid.current = null;
        setProfile(null);
        setLoading(false);
      }
    });
    return () => {sessionGeneration.current++;syncedUid.current=null;unsubAuth();};
  }, []);

  // Public flag: hides the email/password form once the owner has signed in with Google.
  useEffect(() => {
    if (!firebaseConfigured) return undefined;
    return onSnapshot(doc(db, 'calendarSettings', 'auth'),
      snap => setPasswordLoginDisabled(snap.exists() && snap.data().passwordLoginDisabled === true),
      () => setPasswordLoginDisabled(false));
  }, []);

  async function runSync(quiet=false) {
    const checkedUser=auth.currentUser,generation=sessionGeneration.current,identity=sessionIdentity(checkedUser);
    const current=()=>sessionGeneration.current===generation&&sessionIdentity(auth.currentUser)===identity;
    if(!checkedUser)return;
    if(!quiet)setSyncing(true);
    try {
      let parentCheck;
      if(!quiet&&window.self!==window.top){
        try{parentCheck=window.parent.mwaAdminAccessCheck;}catch{/* A separately hosted frame must check its own session. */}
      }
      const res = await (quiet?syncAdminAccess():parentCheck?parentCheck(checkedUser):bootstrapCheck.current(checkedUser));
      if(!current())return;
      if(res?.viewer){setResponseViewer(true);setAuthError('');hadSession.current=true;}
      else if (res && res.admin === false) {
        setAuthError(DENIED_MESSAGES[res.reason] || DENIED_MESSAGES['not-listed']);
        await signOut(auth);
      } else {
        setResponseViewer(false);setAuthError('');
      }
    } catch (error) {
      // If the check itself fails (e.g. offline), fall back to the stored role; rules still enforce it.
      if(current())console.error('Admin session check failed; current stored access remains subject to rules.',error);
    } finally {
      if(current())setSyncing(false);
    }
  }

  // Check every signed-in account against the admin allowlist (server-side) once per session.
  useEffect(() => {
    if (!user || linking.current || syncedUid.current === user.uid) return;
    syncedUid.current = user.uid;
    runSync();
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if(auth.currentUser?.uid!==user.uid)return;
      setProfile(snap.exists() ? snap.data() : null);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user]);

  useEffect(()=>{if(!isResponseViewer)return;const timer=setInterval(()=>runSync(true),30000);return()=>clearInterval(timer);},[isResponseViewer,user?.uid]);
  const email=(user?.email||'').toLowerCase();
  useEffect(()=>{
    if(!user||!email)return;
    return onSnapshot(doc(db,'adminAllowlist',email),snap=>setTeamState({email,entry:snap.exists()?snap.data():null}),()=>setTeamState({email,entry:null}));
  },[user?.uid,email]);
  const teamEntry=teamState.email===email?teamState.entry:null;
  useEffect(()=>{
    const raw=teamEntry?.accessExpiresAt;
    const until=raw?.toMillis?raw.toMillis():new Date(raw).getTime();
    if(!raw||!Number.isFinite(until)||until<=Date.now())return;
    const timer=setTimeout(()=>setClock(Date.now()),Math.min(2147483647,until-Date.now()+20));
    return()=>clearTimeout(timer);
  },[teamEntry,clock]);
  const login = (email, password) => {
    setAuthError('');
    return signInWithEmailAndPassword(auth, email, password);
  };

  const loginWithGoogle = async () => {
    setAuthError('');
    setPendingLink(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      return await signInWithPopup(auth, provider);
    } catch (err) {
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
        return signInWithRedirect(auth, provider);
      }
      if (err?.code === 'auth/account-exists-with-different-credential') {
        const credential = GoogleAuthProvider.credentialFromError(err);
        const email = err?.customData?.email || '';
        if (credential) {
          setPendingLink({ credential, email });
          return null;
        }
      }
      throw err;
    }
  };

  /** One-off: prove ownership of the existing password account, attach Google to it, then
   * continue as a Google sign-in (same uid, so admin role and history are kept). */
  const completeGoogleLink = async (password) => {
    if (!pendingLink) throw new Error('Nothing to link.');
    setAuthError('');
    const { credential, email } = pendingLink;
    linking.current = true;
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      try {
        await linkWithCredential(result.user, credential);
      } catch (err) {
        if (err?.code !== 'auth/provider-already-linked') throw err;
      }
      const signed = await signInWithCredential(auth, credential);
      syncedUid.current = signed.user.uid;
    } catch (err) {
      linking.current = false;
      if (auth.currentUser) await signOut(auth);
      throw err;
    }
    linking.current = false;
    setPendingLink(null);
    await runSync();
  };

  const cancelGoogleLink = () => setPendingLink(null);
  const clearAdminWorkspace=()=>{sessionGeneration.current++;bootstrapCheck.current.reset();setUser(null);setResponseViewer(false);setProfile(null);setTeamState({email:'',entry:null});setPendingLink(null);setLoading(false);setSyncing(false);};
  useEffect(()=>{
    const receiveSignOut=event=>{if(event.key!=='mwa-admin-signout'||!event.newValue)return;clearAdminWorkspace();signOut(auth).then(()=>window.top.location.replace('/')).catch(()=>window.top.location.replace('/'));};
    window.addEventListener('storage',receiveSignOut);
    return()=>window.removeEventListener('storage',receiveSignOut);
  },[]);
  const logout = async () => {
    // Audit delivery must never delay or prevent ending the session.
    void recordActivity('tools-automation','session.signout').catch(()=>{});
    clearAdminWorkspace();
    try{localStorage.setItem('mwa-admin-signout',Date.now()+'-'+Math.random());}catch{}
    await signOut(auth);
    window.top.location.replace('/');
  };
  const ownerIdentity=!!user?.emailVerified&&email===OWNER_EMAIL&&profile?.email?.toLowerCase()===email;
  const provider=user?.providerData?.some(p=>p.providerId==='google.com')?'google.com':'password';
  const boundTeamIdentity=!!teamEntry&&teamEntry.uid===user?.uid&&profile?.email?.toLowerCase()===email;
  const isAdmin=user?.emailVerified===true && profile?.role==='admin' && (ownerIdentity||boundTeamIdentity) && !(passwordLoginDisabled&&provider==='password');
  if(isAdmin)hadSession.current=true;
  const isOwner=isAdmin&&ownerIdentity;
  const accessExpired=!isOwner&&!accessActive(teamEntry);
  const modules=permittedModules(email,teamEntry,isAdmin);
  const canAccess=id=>modules.includes(id);

  return (
    <AuthContext.Provider value={{
      user, profile, isAdmin, isResponseViewer, isOwner, modules, canAccess, accessExpired, accessExpiryDate:teamEntry?.accessExpiryDate||null, loading: loading || syncing || (!!user&&teamState.email!==email), login, loginWithGoogle, logout, authError,
      passwordLoginDisabled, pendingLink, completeGoogleLink, cancelGoogleLink
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

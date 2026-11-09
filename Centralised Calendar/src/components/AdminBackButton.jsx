import {useEffect} from 'react';
import {ArrowLeft} from 'lucide-react';
import {goAdminBack,recordAdminPage} from '../utils/adminNavigation.mjs';
import './admin-back.css';

export default function AdminBackButton({onBack,disabled=false,label='Go back'}) {
  useEffect(() => {
    if (window.self === window.top) recordAdminPage();
  }, []);
  return <button type="button" className="mwa-admin-back" aria-label={label} title={label} disabled={disabled}
    onClick={() => {
      if (onBack) onBack();
      else if (window.self !== window.top) window.parent.postMessage({type:'mwa-admin-back'}, location.origin);
      else goAdminBack();
    }}><ArrowLeft size={22} aria-hidden="true"/></button>;
}

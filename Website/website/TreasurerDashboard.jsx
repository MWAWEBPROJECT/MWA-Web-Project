import React from 'react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';
import {ArrowUpRight,Receipt,Wallet} from 'lucide-react';

export default function TreasurerDashboard(){
 const session=useAuth(),donations=session.isAdmin&&session.canAccess('donations'),expenses=session.isAdmin&&session.canAccess('expenses');
 return <section className="admin-console" aria-labelledby="treasurer-title"><AdminBackButton/>
  <div className="admin-console-intro"><div className="eyebrow">MWA · FINANCE</div><h1 id="treasurer-title">Treasurer’s Dashboard</h1><p>Finance tools available to your account.</p></div>
  {!donations&&!expenses?<p role="alert">Your account does not have access to this dashboard.</p>:<div className="admin-module-grid">
   {donations&&<a className="admin-module is-live" href="/admin-login?module=donations"><div className="admin-module-top"><span className="admin-module-icon"><Receipt aria-hidden="true"/></span><span className="admin-module-status">Live</span></div><h2>Donations <ArrowUpRight aria-hidden="true"/></h2><p>Review receipts, recurring gifts and reconciliation exports.</p></a>}
   {expenses&&<article className="admin-module is-planned"><div className="admin-module-top"><span className="admin-module-icon"><Wallet aria-hidden="true"/></span><span className="admin-module-status">Coming soon</span></div><h2>Expenses</h2><p>Expense management will appear here when this module is ready.</p></article>}
  </div>}
 </section>;
}

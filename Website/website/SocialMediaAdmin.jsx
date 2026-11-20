import React,{useState} from 'react';
import {useAuth} from '@calendar/contexts/AuthContext.jsx';
import AdminBackButton from '@calendar/components/AdminBackButton.jsx';
import {ExternalLink} from 'lucide-react';

const channels=[
 {name:'YouTube',status:'Connected',page:'/media/youtube/',note:'The existing public feed shows the latest five completed MWA livestreams.'},
 {name:'Facebook',status:'Not connected',page:'/media/facebook/',note:'A Meta app and Facebook Page access are needed to authorize a live feed.'},
 {name:'Instagram',status:'Not connected',page:'/media/instagram/',note:'A professional Instagram account and Meta authorization are needed.'},
 {name:'TikTok',status:'Not connected',page:'/media/tiktok/',note:'A TikTok developer app and account authorization are needed.'}
];
export default function SocialMediaAdmin(){
 const session=useAuth(),[selected,setSelected]=useState('');
 if(!session.isAdmin||!session.canAccess('social-media'))return <section className="admin-console"><AdminBackButton/><h1>Social Media Administration</h1><p>Your account does not have access to this module.</p></section>;
 return <section className="admin-console" aria-labelledby="social-admin-title"><AdminBackButton/><div className="admin-console-intro"><div className="eyebrow">MWA · MEDIA HUB</div><h1 id="social-admin-title">Social Media Administration</h1><p>Review each channel before connecting it to the public Media Hub.</p></div><div className="admin-module-grid">{channels.map(channel=><article key={channel.name} className="admin-module"><div className="admin-module-top"><span className="admin-module-status">{channel.status}</span></div><h2>{channel.name}</h2><p>{channel.note}</p><p><a href={channel.page}>View public page <ExternalLink size={14} aria-hidden="true"/></a></p>{channel.status!=='Connected'&&<button type="button" className="btn alt" onClick={()=>setSelected(selected===channel.name?'':channel.name)} aria-expanded={selected===channel.name}>{selected===channel.name?'Close setup':'Connect '+channel.name}</button>}{selected===channel.name&&<div role="status"><p>Account authorization is not configured yet. Ask an administrator of MWA’s {channel.name} account to grant the required provider access. The public page will remain “Coming soon” until the feed is connected and verified.</p></div>}</article>)}</div></section>;
}

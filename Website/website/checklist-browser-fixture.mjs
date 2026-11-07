import {build} from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const entry=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import FormBuilder from './website/FormBuilder.jsx';
import Insights from './website/FormInsights.jsx';
import './website/YouTubePanel.jsx';
const view=new URLSearchParams(location.search).get('view');
const id='11111111-1111-1111-1111-111111111111';
const fields=[{id:'name',type:'text',label:'Full name'},{id:'notes',type:'text',label:'Notes'}];
const form={id,title:'Synthetic community event',eventId:'fixture-event',fields,grantRevision:1};
window.fetch=async url=>{
 let data;
 if(url.includes('youtube-feed'))data={items:Array.from({length:5},(_,i)=>({id:'abcdefghij'+i,title:'Synthetic livestream '+(i+1),thumbnail:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22%3E%3Crect width=%22320%22 height=%22180%22 fill=%22%23176446%22/%3E%3C/svg%3E',endedAt:'2026-11-01T00:00:00Z',embeddable:true}))};
 else if(url.includes('/api/form-insights/events'))data={events:[{id:'fixture-event',title:'Synthetic community event',startAt:'2026-10-01T00:00:00Z',status:'confirmed',indexedForms:1,sourceResponses:1,indexedResponses:1,reconciliationStatus:'Counts match; history coverage incomplete',coverageStatus:'incomplete'}],coverage:{status:'incomplete',label:'Coverage incomplete',reason:'Synthetic fixture only; source history is not fully reconciled.',indexScanTruncated:false,sourceReconciliationTruncated:false}};
 else if(url.includes('/api/form-insights/authorize-export'))data={ok:true};
 else if(url.includes('form-insights'))data={submissions:12,forms:2,events:1,generatedAt:new Date().toISOString(),filters:{from:'2026-01-01',to:'2026-11-07',dateMode:'custom'},coverage:{label:'Coverage incomplete'},years:[{year:'2026',count:12}],months:[{month:'2026-09',count:2},{month:'2026-10',count:4},{month:'2026-11',count:6}],eventRows:[{id:'fixture-event',title:'Synthetic community event',count:12}],candidates:[],items:[{reference:'MWA-SYNTHETIC',formTitle:'Synthetic form',eventTitle:'Synthetic community event',eventId:'fixture-event',submittedAt:'2026-10-01T00:00:00Z'}],drilldownAvailable:true,pageSize:50,nextCursor:null,totalMatching:12,definitions:'Synthetic fixture only — not MWA data.'};
 else if(url.includes('/responses'))data={items:[{id:'response',reference:'MWA-R-FIXTURE',createdAt:new Date().toISOString(),revision:1,formTitle:form.title,fields,answers:{name:'Example Person',notes:'Synthetic long answer for export layout verification. '.repeat(80)}}],next:null};
 else if(url.includes('/export'))data={ok:true};
 else data={items:[form],next:null};
 return {ok:true,json:async()=>data};
};
if(view!=='youtube')createRoot(document.getElementById('root')).render(view==='insights'?<Insights/>:<FormBuilder/>);
`;
const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',loader:{'.png':'dataurl'},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/^@calendar\/(contexts|firebase)\//},a=>({path:a.path,namespace:'fixture'}));
 b.onResolve({filter:/^@calendar\//},a=>({path:path.resolve(root,'../Centralised Calendar/src',a.path.replace('@calendar/',''))}));
 b.onResolve({filter:/^@mwa\/appearance$/},()=>({path:path.resolve(root,'shared/appearance.js')}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.includes('AuthContext')?`export const useAuth=()=>({isResponseViewer:new URLSearchParams(location.search).get('view')!=='insights',isAdmin:new URLSearchParams(location.search).get('view')==='insights',loading:false,isOwner:false,canAccess:id=>['form-insights','form-insights-people','form-insights-export','events-bookings'].includes(id),logout:()=>{document.getElementById('root').textContent='Signed out';},user:{uid:'fixture'}});`:`export const auth={currentUser:{uid:'fixture',getIdToken:async()=>'fixture-only'}};`,loader:'js'}));
 b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
}}]});
const css=['website/registrations.css','website/youtube-panel.css','website/website-polish.css'].map(p=>fs.readFileSync(p,'utf8')).join('\n');
http.createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 const youtube=req.url.includes('view=youtube');
 res.setHeader('Content-Type','text/html');
 res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>MWA synthetic verification</title><style>:root{--ink:#19392e;--muted:#53645a;--surface:white;--paper:#f6f8f5;--line:#cad6cf;--soft:#eaf1eb;--accent:#176446}body{margin:20px;font:16px Segoe UI,Arial;background:var(--paper);color:var(--ink)}button,input,select{font:inherit;padding:10px}button{cursor:pointer}label{display:block;margin:12px 0}input,select{display:block}table{width:100%;text-align:left}td,th{padding:10px}'+css+'</style><p>SYNTHETIC TEST DATA ONLY</p><div id="'+(youtube?'youtube-panel-root':'root')+'"></div><script src="/bundle.js"></script>');
}).listen(5178,'127.0.0.1',()=>console.log('Checklist UI fixture http://127.0.0.1:5178'));

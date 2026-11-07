import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=await build({stdin:{contents:`export {default as FormBuilder} from './website/FormBuilder.jsx';export {default as AdminConsole} from './website/AdminConsole.jsx';export {default as InsightsDetail} from './website/InsightsDetail.jsx';export {default as InsightsPeople} from './website/InsightsPeople.jsx';export {default as RegistrationFields} from './website/RegistrationFields.jsx';export {default as RegistrationShare} from './website/RegistrationShare.jsx';export {default as RegistrationPoster} from './website/RegistrationPoster.jsx';export {default as Registrations} from './website/Registrations.jsx';export {RegistrationIntroduction,RegistrationIntroductionEditor} from './website/RegistrationIntroduction.jsx';export {EventCoverageTable,InsightsDrilldown} from './website/FormInsights.jsx';export {default as FormInsights} from './website/FormInsights.jsx';export {MappingScanControls} from './website/InsightsMapping.jsx';export {ChoiceChart,FirstKnownChart,YearOverYearChart} from './website/InsightsCharts.jsx';`,resolveDir:root,loader:'jsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',plugins:[{name:'form-fixtures',setup(builder){
 builder.onResolve({filter:/^@calendar\/contexts\/AuthContext\.jsx$/},()=>({path:'auth',namespace:'fixture'}));
 builder.onResolve({filter:/^@calendar\/firebase\/firebase\.js$/},()=>({path:'firebase',namespace:'fixture'}));
 builder.onResolve({filter:/^@mwa\/access$/},()=>({path:path.resolve(root,'shared/module-access.js')}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({contents:p==='auth'?'export const useAuth=()=>globalThis.__formSession;':'export const auth={currentUser:null};',loader:'js'}));
 builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
}}]});
const module={exports:{}};
new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {FormBuilder,AdminConsole,InsightsDetail,InsightsPeople,RegistrationFields,RegistrationShare,RegistrationPoster,Registrations,RegistrationIntroduction,RegistrationIntroductionEditor,EventCoverageTable,InsightsDrilldown,FormInsights,MappingScanControls,ChoiceChart,FirstKnownChart,YearOverYearChart}=module.exports;
test('year-over-year chart shows real values and handles partial or zero baselines',()=>{
 const html=renderToStaticMarkup(React.createElement(YearOverYearChart,{items:[{date:'2026-02-01',count:3}],filters:{from:'2025-01-01',to:'2026-12-31'},onSelect:()=>{}}));
 assert.match(html,/Year-over-year submissions bar chart/);assert.match(html,/percentage unavailable/);assert.match(html,/2026: 3 submissions; filter report/);
 const partial=renderToStaticMarkup(React.createElement(YearOverYearChart,{items:[],filters:{from:'2025-06-01',to:'2026-03-01'},onSelect:()=>{}}));assert.match(partial,/no matching dates/);
 const leap=renderToStaticMarkup(React.createElement(YearOverYearChart,{items:[{date:'2024-02-29',count:3}],filters:{from:'2023-01-01',to:'2024-12-31'},onSelect:()=>{}}));assert.match(leap,/disabled="" aria-label="2024: 0 submissions; selection unavailable"/);
});
test('choice and first-known charts disclose counts and render accessible safe controls',()=>{
 const choice=renderToStaticMarkup(React.createElement(ChoiceChart,{options:[{label:'A',count:2},{label:'B',count:1}],answered:2}));
 assert.match(choice,/Choice responses bar chart/);assert.match(choice,/A: 2/);assert.match(choice,/Multi-select/);
 const first=renderToStaticMarkup(React.createElement(FirstKnownChart,{counts:{firstKnown:2,returning:1,identified:3},onSelect:()=>{}}));
 assert.match(first,/First-known: 2 respondents; show list/);assert.match(first,/Returning: 1 respondents; show list/);assert.match(first,/not attendance/);
 const empty=renderToStaticMarkup(React.createElement(FirstKnownChart,{counts:{firstKnown:0,returning:0,identified:0},onSelect:()=>{}}));assert.match(empty,/No confirmed respondents/);assert.doesNotMatch(empty,/show list/);
});
test('programme category review appears only for Super Admin and explains scoped detail limits',()=>{
 try{
  globalThis.__formSession={loading:false,isAdmin:true,isOwner:false,user:{uid:'fixture'},canAccess:id=>id==='form-insights'};
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(FormInsights)),/Programme category review/);
  globalThis.__formSession.isOwner=true;
  const html=renderToStaticMarkup(React.createElement(FormInsights));
  assert.match(html,/Programme category review/);assert.match(html,/Scoped detail remains limited to its separate assignment/);
 }finally{delete globalThis.__formSession;}
});
test('Insights workspace is isolated by account and permission scope',()=>{
 try{
  const session={loading:false,isAdmin:true,isOwner:false,user:{uid:'first'},modules:['form-insights'],canAccess(id){return this.modules.includes(id);}};
  globalThis.__formSession=session;
  const base=FormInsights().key;
  for(const id of ['events-bookings','form-insights-people','form-insights-export']){
   session.modules=['form-insights',id];assert.notEqual(FormInsights().key,base);
  }
  session.modules=['form-insights'];session.isOwner=true;assert.notEqual(FormInsights().key,base);
  session.isOwner=false;session.user={uid:'first',email:'changed@example.invalid'};assert.notEqual(FormInsights().key,base);
  session.isOwner=false;session.user={uid:'second'};assert.notEqual(FormInsights().key,base);
  session.modules=[];assert.match(renderToStaticMarkup(React.createElement(FormInsights)),/access is not assigned/);
 }finally{delete globalThis.__formSession;}
});
test('an absent or removed optional poster renders no panel or reserved image space',()=>{
 for(const props of [{form:{}},{form:{id:'legacy',title:'Legacy'}},{form:{id:'form',poster:{size:'medium'}},removed:true},{form:{},upload:null}]){
  assert.equal(renderToStaticMarkup(React.createElement(RegistrationPoster,props)),'');
 }
});
test('people-only respondent review is independent of aggregate and detail grants',()=>{
 for(const modules of [[],['form-insights'],['form-insights-people']]){
  globalThis.__formSession={loading:false,isAdmin:true,canAccess:id=>modules.includes(id),user:{uid:'fixture'}};
  const canReview=modules.includes('form-insights-people');
  const consoleHtml=renderToStaticMarkup(React.createElement(AdminConsole,{email:'fixture@example.invalid'}));
  assert.equal(consoleHtml.includes('module=insights-people'),canReview);
  const html=renderToStaticMarkup(React.createElement(InsightsPeople));
  assert.equal(html.includes('Start revision inspection'),canReview);
  assert.equal(html.includes('Show respondent timeline'),canReview);
  assert.equal(html.includes('Find accessible events'),canReview);
  assert.equal(html.includes('Compare events'),canReview);
  assert.equal(html.includes('Search respondent records'),canReview);
  assert.equal(html.includes('Run first-known report'),canReview);
  assert.equal(html.includes('people access is not assigned'),!canReview);
 }
 delete globalThis.__formSession;
});
test('separate detail entry does not imply aggregate access and explains intersection',()=>{
 globalThis.__formSession={loading:false,isAdmin:true,isOwner:false,user:{uid:'fixture'},canAccess:()=>false};
 try{
  const consoleHtml=renderToStaticMarkup(React.createElement(AdminConsole,{email:'fixture@example.invalid'}));
  assert.match(consoleHtml,/module=insights-detail/);assert.doesNotMatch(consoleHtml,/href="\/admin-login\?module=form-insights"/);
  const html=renderToStaticMarkup(React.createElement(InsightsDetail));
  assert.match(html,/separate from aggregate Insights/);assert.match(html,/saved event ID/);assert.match(html,/selected form <strong>and<\/strong>/);assert.doesNotMatch(html,/Manage explicit admin assignments/);
  globalThis.__formSession.isAdmin=false;assert.match(renderToStaticMarkup(React.createElement(InsightsDetail)),/active admin account is required/);
 }finally{delete globalThis.__formSession;}
});
test('Form Builder is an independent module with a dedicated link and access guard',()=>{
 for(const modules of [[],['website-cms'],['form-builder']]){
  globalThis.__formSession={isAdmin:true,canAccess:id=>modules.includes(id),user:{uid:'fixture'}};
  const builder=renderToStaticMarkup(React.createElement(FormBuilder));
  assert.equal(builder.includes('Create form'),modules.includes('form-builder'));
  assert.equal(builder.includes('does not have access'),!modules.includes('form-builder'));
  const consoleHtml=renderToStaticMarkup(React.createElement(AdminConsole,{email:'fixture@example.com'}));
  assert.equal(consoleHtml.includes('href="/admin-login?module=form-builder"'),modules.includes('form-builder'));
 }
 delete globalThis.__formSession;
});
test('Community Connect choice and consent render safely with accessible labels',()=>{
 const fields=[
  {id:'choice',type:'radio',label:'Choose <script>',options:['One','Two'],description:'One option',required:true},
  {id:'consent',type:'consent',label:'Agreement',description:'Read the terms',terms:'No <script> execution',required:true},
 ];
 const html=renderToStaticMarkup(React.createElement(RegistrationFields,{fields,answers:{choice:'One',consent:true},onChange:()=>{}}));
 assert.match(html,/Choose &lt;script&gt;/);assert.match(html,/No &lt;script&gt; execution/);assert.match(html,/<legend>/);assert.match(html,/aria-required="true"/);assert.match(html,/checked=""/);
  assert.match(html,/<p class="registration-help" id="[^"]+-help">One option<\/p>/);
 });
 test('Form Builder event linking lists the selected date events as choices, not a dropdown',async()=>{
  const fs=await import('node:fs/promises');const source=await fs.readFile(path.resolve(root,'website/FormBuilder.jsx'),'utf8');
  assert.match(source,/event-choice-list/);assert.match(source,/type="radio"/);assert.doesNotMatch(source,/Find events/);
  const html=await fs.readFile(path.resolve(root,'website/index.html'),'utf8');assert.doesNotMatch(html,/<select id="niaz-event"/);assert.match(html,/id="niaz-event" class="niaz-event-list" role="radiogroup"/);
 });
test('rich introductions render bold text while escaping markup and expose an accessible editor',()=>{
 const runs=[{text:'Welcome ',bold:false},{text:'everyone',bold:true},{text:' <script>alert(1)</script>',bold:false}];
 const html=renderToStaticMarkup(React.createElement(RegistrationIntroduction,{description:'Welcome everyone',descriptionRuns:runs}));
 assert.match(html,/<strong>everyone<\/strong>/);assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
 const editor=renderToStaticMarkup(React.createElement(RegistrationIntroductionEditor,{description:'Welcome everyone',descriptionRuns:runs,onChange:()=>{}}));
 assert.match(editor,/aria-label="Introduction"/);assert.match(editor,/role="textbox"/);assert.match(editor,/>Bold</);assert.match(editor,/<strong>everyone<\/strong>/);
 const legacy=renderToStaticMarkup(React.createElement(RegistrationIntroduction,{description:'Legacy <b>text</b>'}));
 assert.match(legacy,/Legacy &lt;b&gt;text&lt;\/b&gt;/);assert.doesNotMatch(legacy,/<b>/);
});
test('event coverage render calls zero a count of indexed responses, not no registrations',()=>{
 const html=renderToStaticMarkup(React.createElement(EventCoverageTable,{events:[{id:'private-id',title:'Private event',startAt:'2026-10-01T00:00:00Z',status:'confirmed',indexedForms:0,indexedResponses:0,coverageStatus:'incomplete'}],coverage:{label:'Coverage incomplete',reason:'Source responses have not been comprehensively reconciled.',indexScanTruncated:false},showIds:false}));
 assert.match(html,/0 indexed responses/);assert.match(html,/Coverage incomplete/);assert.match(html,/not been comprehensively reconciled/);assert.doesNotMatch(html,/private-id/);assert.doesNotMatch(html,/no registrations/i);
});
test('Insights exposes Sydney date, month, year and event filters with a protected paginated drilldown',()=>{
 globalThis.__formSession={loading:false,isAdmin:true,isOwner:false,canAccess:id=>['form-insights','form-insights-people','events-bookings'].includes(id)};
 try{
  const html=renderToStaticMarkup(React.createElement(FormInsights));
  assert.match(html,/Reporting period/);assert.match(html,/Custom date range/);assert.match(html,/Sydney calendar month/);assert.match(html,/Sydney calendar year/);assert.match(html,/Date basis/);assert.match(html,/Event \(optional\)/);assert.match(html,/Candidate answer search/);
  assert.match(html,/Reviewed mapped-answer analysis/);assert.match(html,/Analyse mapped answers/);assert.match(html,/Text, contact and consent values are excluded/);
  assert.match(html,/indexed responses, which may lag source corrections/);assert.match(html,/current calendar date for all indexed responses/);assert.match(html,/excluded from event-date reports/);assert.match(html,/Calendar changes are not checked by source\/index reconciliation/);
  const rows=renderToStaticMarkup(React.createElement(InsightsDrilldown,{report:{drilldownAvailable:true,items:[{reference:'MWA-SYNTHETIC',formTitle:'Synthetic form',eventTitle:'Public event',submittedAt:'2026-10-01T00:00:00Z'}],totalMatching:51,nextCursor:'next'},pageIndex:0,onPage:()=>{},canPage:true}));
  assert.match(rows,/MWA-SYNTHETIC/);assert.match(rows,/page 1 of matching indexed response references \(51 total/);assert.match(rows,/Next page/);assert.doesNotMatch(rows,/person@example\.invalid|0412345678|secret answer/i);
  const denied=renderToStaticMarkup(React.createElement(InsightsDrilldown,{report:{drilldownAvailable:false},pageIndex:0,onPage:()=>{},canPage:true}));
  assert.match(denied,/separately assigned Form Insights person-search permission/);
 }finally{delete globalThis.__formSession;}
});
test('only Super Admin renders reconciliation controls',()=>{
 for(const isOwner of [true,false]){
  globalThis.__formSession={loading:false,isAdmin:true,isOwner,canAccess:id=>id==='form-insights'};
  const html=renderToStaticMarkup(React.createElement(FormInsights));
  assert.equal(html.includes('Start a new reconciliation scan'),isOwner);
  assert.equal(html.includes('Historical index preparation — Super Admin'),isOwner);
  assert.equal(html.includes('Historical question mapping review'),isOwner);
  assert.equal(html.includes('Inspect revision'),isOwner);
  assert.equal(html.includes('Respondent link review'),false);
  if(isOwner)assert.match(html,/do not alter responses, consent, indexes or identity links/);
 }
 delete globalThis.__formSession;
});
test('mapping scan progress is incomplete until finished and offers cancellation',()=>{
 const running=renderToStaticMarkup(React.createElement(MappingScanControls,{job:{status:'running',scanned:100},label:'Revision inspection'}));
 assert.match(running,/100 response snapshots scanned/);assert.match(running,/incomplete/);assert.match(running,/Continue revision inspection/);assert.match(running,/Cancel revision inspection/);
 const invalid=renderToStaticMarkup(React.createElement(MappingScanControls,{job:{status:'invalidated',scanned:100},label:'Revision inspection'}));
 assert.match(invalid,/Source or form changed/);assert.doesNotMatch(invalid,/Continue revision inspection|Cancel revision inspection/);
});
test('saved open forms provide sharing controls, but drafts and expired forms do not',()=>{
 globalThis.location={origin:'https://refreshed.muhammadiwelfare.org.au'};
 try{
  const form={id:'a4b0d27e-f2fd-4f2c-941f-36638a7d61ed',title:'Community form',published:true,expiresAt:'9999-12-31T00:00:00.000Z'};
  const html=renderToStaticMarkup(React.createElement(RegistrationShare,{form}));
  assert.match(html,/Copy link/);assert.match(html,/WhatsApp/);assert.match(html,/Text message/);assert.match(html,/shared=1/);
  for(const closed of [{...form,published:false},{...form,expiresAt:'2020-01-01T00:00:00.000Z'}]){
   assert.doesNotMatch(renderToStaticMarkup(React.createElement(RegistrationShare,{form:closed})),/Copy link|href=/);
  }
 }finally{delete globalThis.location;}
});
test('shared form route omits website registration navigation without changing the normal route',()=>{
 try{
  globalThis.location={search:'?form=a4b0d27e-f2fd-4f2c-941f-36638a7d61ed&shared=1'};
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Registrations)),/All registrations|Back to Home/);
  globalThis.location.search='?form=a4b0d27e-f2fd-4f2c-941f-36638a7d61ed';
  assert.match(renderToStaticMarkup(React.createElement(Registrations)),/All registrations/);
 }finally{delete globalThis.location;}
});

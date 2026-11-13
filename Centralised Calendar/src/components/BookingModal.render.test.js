import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import react from '@vitejs/plugin-react';
import {createServer} from 'vite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('booking gate hides booking fields for visitors and opens directly for authenticated volunteers/admins',async()=>{
 const mocks={name:'booking-gate-mocks',enforce:'pre',resolveId(source){
  if(source==='../firebase/firebase.js')return '\0booking-firebase';
  if(source==='firebase/auth')return '\0booking-auth';
  if(source==='../services/eventsService.js')return '\0booking-events';
  if(source==='../services/phoneBookingAuth.js')return '\0booking-phone';
  if(source==='./ProgramExtras.jsx')return '\0booking-extras';
 },load(id){
  if(id==='\0booking-firebase')return 'export const auth={get currentUser(){return globalThis.__bookingUser||null}};';
  if(id==='\0booking-auth')return 'export const onAuthStateChanged=()=>()=>{};';
  if(id==='\0booking-events')return 'export const '+['submitBooking','decideBooking','updateBookingScoped','createRecurringBooking','deleteBooking','checkSlotConflicts','previewRecurringBooking','startBookingVerification','verifyBookingEmailCode','verifyBookingMobile'].map(x=>x+'=async()=>({})').join(',')+';';
  if(id==='\0booking-phone')return 'export const clearBookingPhoneRecaptcha=()=>{},normalizeBookingPhone=x=>x,confirmBookingPhoneCode=async()=>{},sendBookingPhoneCode=async()=>{};';
  if(id==='\0booking-extras')return 'export const ProgramExtrasSummary=()=>null,ProgramExtrasEditor=()=>null;';
 }};
 const server=await createServer({configFile:false,root,plugins:[mocks,react()],server:{middlewareMode:true},appType:'custom'});
 const previousWindow=globalThis.window;globalThis.window={crypto:globalThis.crypto};
 try{
 const {BookingModalInner}=await server.ssrLoadModule('/src/components/BookingModal.jsx');
 const props={open:true,onClose:()=>{},venues:[],departments:[],hijriOverrides:[],isAdmin:false};
 globalThis.__bookingUser=null;let html=renderToStaticMarkup(React.createElement(BookingModalInner,props));assert.match(html,/Verify your contact/);assert.doesNotMatch(html,/Contact name/);assert.doesNotMatch(html,/Submit request/);
 globalThis.__bookingUser={uid:'volunteer',emailVerified:true,isAnonymous:false};html=renderToStaticMarkup(React.createElement(BookingModalInner,props));assert.match(html,/Contact name/);assert.match(html,/Programme audience/);for(const label of ['Family Event','Gents only','Ladies only','Kids only'])assert(html.includes(label));assert.match(html,/Submit request/);assert.doesNotMatch(html,/Verify your contact/);
 html=renderToStaticMarkup(React.createElement(BookingModalInner,{...props,isAdmin:true}));assert.match(html,/Contact name/);assert.doesNotMatch(html,/Verify your contact/);
 globalThis.__bookingUser={uid:'anon',emailVerified:false,isAnonymous:true};html=renderToStaticMarkup(React.createElement(BookingModalInner,props));assert.match(html,/Verify your contact/);
 const programme={id:'event_1-A',title:'Synthetic programme',startAt:'2027-01-10T23:30:00Z',endAt:'2027-01-11T01:00:00Z',departmentName:'MWA Programs',status:'confirmed',visibility:'public'};
 html=renderToStaticMarkup(React.createElement(BookingModalInner,{...props,editing:programme}));
 assert.match(html,/href="\/niaz\/\?event=event_1-A&amp;date=2027-01-11" target="_top"/);
 for(const editing of [{...programme,masked:true},{...programme,status:'pending'},{...programme,departmentName:'Other'}]){
  html=renderToStaticMarkup(React.createElement(BookingModalInner,{...props,editing}));
  assert.doesNotMatch(html,/Offer Niaz sponsorship/);
 }
 }finally{globalThis.window=previousWindow;delete globalThis.__bookingUser;await server.close();}
});

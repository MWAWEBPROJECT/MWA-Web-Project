const form=document.getElementById('donation-form');
const notice=document.createElement('p');notice.className='tiny';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');form.append(notice);
let requestId=null,lastPayload=null;
form.onsubmit=async event=>{
 event.preventDefault();const first=document.getElementById('recurring-first-date');first.min=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());first.setCustomValidity(first.value&&first.value<first.min?'The first recurring date cannot be earlier than today (Sydney time).':'');const niazDate=document.getElementById('niaz-date'),niazEvent=document.querySelector('input[name="niaz-event"]:checked');niazDate.setCustomValidity(!document.getElementById('niaz-event-fields').disabled&&niazDate.value&&!niazEvent?'Choose one of the events listed for this date, or select general Niaz.':'');if(!form.reportValidity())return;
 const donationMode=document.querySelector('input[name="donation-mode"]:checked').value;const recurringOptIn=donationMode!=='one_off';
 const payload={donationMode,fitra:{category:document.getElementById('fitra-category').value},name:document.getElementById('donation-name').value.trim(),mobile:document.getElementById('donation-mobile').value.trim(),notes:document.getElementById('donation-notes').value.trim(),niaz:{scope:document.getElementById('niaz-scope').value,date:document.getElementById('niaz-date').value,eventId:niazEvent?.value||''},khums:{marja:document.getElementById('khums-marja').value,type:document.getElementById('khums-type').value},email:document.getElementById('donation-email').value.trim(),fund:document.getElementById('fund').value,amount:donationMode==='recurring_only'?null:document.getElementById('amount').value,recurringOptIn,recurring:recurringOptIn?{amount:document.getElementById('recurring-amount').value,frequency:document.getElementById('recurring-frequency').value,firstDate:document.getElementById('recurring-first-date').value}:null};
 const fingerprint=JSON.stringify(payload);if(lastPayload!==fingerprint){requestId=crypto.randomUUID();lastPayload=fingerprint;}
 if(recurringOptIn&&!confirm(`Sandbox donation: ${donationMode==='recurring_only'?'no one-off payment;':'$'+payload.amount+' once now, plus'} $${payload.recurring.amount} ${payload.recurring.frequency} starting ${payload.recurring.firstDate}.\n\nYou authorise the additional recurring test payments until cancelled. If the start date is today, the first recurring charge is due today. No real money moves. Continue?`))return;
 const button=form.querySelector('button[type="submit"]');button.disabled=true;notice.textContent='Opening secure Stripe test checkout…';
 try{const response=await fetch('/api/donations/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId})});const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to open checkout.');const url=new URL(result.url);if(url.origin!=='https://checkout.stripe.com')throw Error('Unexpected checkout address.');location.assign(url.href);}
 catch(error){notice.textContent=error.message;button.disabled=false;}
};
const query=new URLSearchParams(location.search);
const watchKey='mwa-donation-watch';
const readWatch=()=>{try{const v=JSON.parse(sessionStorage.getItem(watchKey));return v&&Date.now()-v.startedAt<30*60*1000?v:null;}catch{return null;}};
const saveWatch=value=>{try{if(value)sessionStorage.setItem(watchKey,JSON.stringify(value));else sessionStorage.removeItem(watchKey);}catch{}};
const returnedId=query.get('donation_result');
let watch=readWatch();
if(returnedId&&watch?.id!==returnedId){watch={id:returnedId,startedAt:Date.now(),dismissed:false,announced:false};saveWatch(watch);}
const id=returnedId||watch?.id;
let activeToast;
function confirmedToast(){
 if(activeToast){if(watch?.setupNotice){activeToast.querySelector('strong').textContent=watch.setupNotice.title;activeToast.querySelector('p').textContent=watch.setupNotice.message;}return;}if(watch?.toastDismissed)return;
 const toast=document.createElement('aside');toast.className='donation-confirmed-toast';toast.setAttribute('aria-label','Payment notification');
 toast.innerHTML='<div role="status" aria-live="polite"><strong>✓ Payment confirmed</strong><p>Your sandbox donation was successful. No real money was charged.</p></div><button type="button" aria-label="Dismiss payment confirmation">×</button>';
 if(watch?.setupNotice){toast.querySelector('strong').textContent=watch.setupNotice.title;toast.querySelector('p').textContent=watch.setupNotice.message;}
 toast.querySelector('button').onclick=()=>{toast.remove();activeToast=null;if(watch){watch.toastDismissed=true;saveWatch(watch);}};activeToast=toast;document.body.append(toast);
}
if(id||query.has('donation_cancelled')){
 const dialog=document.createElement('dialog');dialog.className='donation-result-dialog';dialog.setAttribute('aria-labelledby','donation-result-title');
 dialog.innerHTML='<div class="donation-result-mark" aria-hidden="true">◷</div><p class="eyebrow">MWA · Sandbox donation</p><h2 id="donation-result-title"></h2><p id="donation-result-message" role="status" aria-live="polite"></p><p class="tiny">This was a sandbox checkout. No real money is deducted.</p><div class="donation-result-actions"><button type="button" class="btn alt" id="donation-result-retry">Check again</button><button type="button" class="btn" id="donation-result-close">Continue browsing</button></div>';
 document.body.append(dialog);
 const heading=dialog.querySelector('h2'),message=dialog.querySelector('[role="status"]'),mark=dialog.querySelector('.donation-result-mark'),retry=dialog.querySelector('#donation-result-retry');
 dialog.querySelector('#donation-result-close').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{if(watch){watch.dismissed=true;saveWatch(watch);if(watch.paid)confirmedToast();}});
 const show=(title,text,kind='pending')=>{heading.textContent=title;message.textContent=text;notice.textContent=title+'. '+text;mark.textContent=kind==='success'?'✓':kind==='error'?'!':'◷';dialog.dataset.state=kind;};
 let timer,attempts=0,busy=false;
 const schedule=()=>{if(watch&&Date.now()-watch.startedAt<30*60*1000)timer=setTimeout(poll,attempts++<15?4000:15000);};
 const poll=async()=>{if(busy)return;busy=true;retry.disabled=true;clearTimeout(timer);
  try{
   const response=await fetch('/api/donations/status?id='+encodeURIComponent(id),{signal:AbortSignal.timeout(15000)});const d=await response.json();if(!response.ok)throw Error('Unavailable');
   if(d.donationMode==='recurring_only'&&['setup_complete','setup_authorised','setup_needs_attention'].includes(d.status)){
    const ready=['scheduled','active'].includes(d.recurring),failed=d.recurring==='needs_attention'||d.status==='setup_needs_attention',ended=['canceled','aborted','completed','cancelling'].includes(d.recurring);
    const title=failed?'Recurring setup needs attention':ended?'Recurring arrangement '+d.recurring:ready?'Recurring donation set up':'Card authorisation confirmed';
    const text=failed?'Your card was authorised, but the schedule needs administrator attention. No one-off payment was requested. Please contact MWA rather than submitting another setup.':ended?'This recurring arrangement is '+d.recurring+'. No one-off donation was requested.':ready?'Your recurring donation starts on '+d.firstDate+' (Sydney). No one-off payment was requested. Setup confirmation is not a payment receipt.':'We are preparing your recurring schedule. No one-off payment was requested.';
    show(title,text,failed?'error':ready?'success':'pending');if(watch){watch.paid=true;watch.setupNotice={title,message:text};saveWatch(watch);if(!dialog.open)confirmedToast();}retry.hidden=!d.fulfillmentPending;if(d.fulfillmentPending)schedule();
   }else if(d.status==='paid'){
    const recurring=!d.recurring?'No recurring donation was selected.':d.recurring==='scheduled'||d.recurring==='active'?'Your additional recurring donation has been scheduled.':d.recurring==='needs_attention'?'Your one-off payment succeeded, but recurring setup needs administrator attention. Please do not pay again.':['canceled','aborted','completed','cancelling'].includes(d.recurring)?'The recurring arrangement is '+d.recurring+'.':'Your recurring setup is still being confirmed.';
    show('Thank you — payment confirmed', 'Your one-off sandbox donation was successful. '+recurring+(d.fulfillmentPending?' Your confirmation email and any recurring setup are being prepared.':' A confirmation email is queued for the email address supplied at checkout.'), 'success');
    if(watch){watch.paid=true;saveWatch(watch);if(!dialog.open)confirmedToast();}
    retry.hidden=!d.fulfillmentPending;if(d.fulfillmentPending)schedule();
   }else if(d.status==='expired'){show('Checkout expired','No successful payment was confirmed for this checkout.','error');retry.hidden=true;}
   else {show(d.donationMode==='recurring_only'?'Confirming your authorisation':'Confirming your payment', 'We are checking your Stripe checkout. This usually takes a few seconds. Please do not submit it again.');schedule();}
  }catch{show('Unable to check payment yet','Your payment may still have completed. Please use Check again; do not pay again.','error');schedule();}
  finally{busy=false;retry.disabled=false;}
 };
 retry.onclick=()=>{attempts=0;poll();};
 if(id){show('Checking your Stripe checkout','We are verifying your payment or recurring authorisation with Stripe. Please do not submit it again.');if(returnedId&&!watch?.dismissed)dialog.showModal();poll();}
 else{show('Checkout cancelled','You returned without completing this checkout. No successful payment has been confirmed.');retry.hidden=true;dialog.showModal();}
}

form.addEventListener('reset',()=>{setTimeout(()=>{for(const input of form.querySelectorAll('input,select,textarea'))input.setCustomValidity?.('');for(const input of form.querySelectorAll('select,input[type=radio]'))input.dispatchEvent(new Event('change',{bubbles:true}));notice.textContent='';},0);});

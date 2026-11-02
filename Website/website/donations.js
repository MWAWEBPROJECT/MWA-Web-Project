const form=document.getElementById('donation-form');
const notice=document.createElement('p');notice.className='tiny';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');form.append(notice);
let requestId=null,lastPayload=null;
form.onsubmit=async event=>{
 event.preventDefault();if(!form.reportValidity())return;
 const recurringOptIn=document.getElementById('recurring-opt-in').checked;
 const payload={email:document.getElementById('donation-email').value.trim(),fund:document.getElementById('fund').value,amount:document.getElementById('amount').value,recurringOptIn,recurring:recurringOptIn?{amount:document.getElementById('recurring-amount').value,frequency:document.getElementById('recurring-frequency').value,firstDate:document.getElementById('recurring-first-date').value}:null};
 const fingerprint=JSON.stringify(payload);if(lastPayload!==fingerprint){requestId=crypto.randomUUID();lastPayload=fingerprint;}
 if(recurringOptIn&&!confirm(`Sandbox donation: $${payload.amount} once now, plus $${payload.recurring.amount} ${payload.recurring.frequency} starting ${payload.recurring.firstDate}.\n\nYou authorise the additional recurring test payments until cancelled. If the start date is today, both charges are due today. No real money moves. Continue?`))return;
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
function confirmedToast(){
 const toast=document.createElement('aside');toast.className='donation-confirmed-toast';toast.setAttribute('aria-label','Payment notification');
 toast.innerHTML='<div role="status" aria-live="polite"><strong>✓ Payment confirmed</strong><p>Your sandbox donation was successful. No real money was charged.</p></div><button type="button" aria-label="Dismiss payment confirmation">×</button>';
 toast.querySelector('button').onclick=()=>toast.remove();document.body.append(toast);
}
if(id||query.has('donation_cancelled')){
 const dialog=document.createElement('dialog');dialog.className='donation-result-dialog';dialog.setAttribute('aria-labelledby','donation-result-title');
 dialog.innerHTML='<div class="donation-result-mark" aria-hidden="true">◷</div><p class="eyebrow">MWA · Sandbox donation</p><h2 id="donation-result-title"></h2><p id="donation-result-message" role="status" aria-live="polite"></p><p class="tiny">This was a test payment. No real money is deducted.</p><div class="donation-result-actions"><button type="button" class="btn alt" id="donation-result-retry">Check again</button><button type="button" class="btn" id="donation-result-close">Continue browsing</button></div>';
 document.body.append(dialog);
 const heading=dialog.querySelector('h2'),message=dialog.querySelector('[role="status"]'),mark=dialog.querySelector('.donation-result-mark'),retry=dialog.querySelector('#donation-result-retry');
 dialog.querySelector('#donation-result-close').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{if(watch){watch.dismissed=true;saveWatch(watch);}});
 const show=(title,text,kind='pending')=>{heading.textContent=title;message.textContent=text;notice.textContent=title+'. '+text;mark.textContent=kind==='success'?'✓':kind==='error'?'!':'◷';dialog.dataset.state=kind;};
 let timer,attempts=0,busy=false;
 const poll=async()=>{if(busy)return;busy=true;retry.disabled=true;clearTimeout(timer);
  try{
   const response=await fetch('/api/donations/status?id='+encodeURIComponent(id),{signal:AbortSignal.timeout(15000)});const d=await response.json();if(!response.ok)throw Error('Unavailable');
   if(d.status==='paid'){
    const recurring=!d.recurring?'No recurring donation was selected.':d.recurring==='scheduled'||d.recurring==='active'?'Your additional recurring donation has been scheduled.':d.recurring==='needs_attention'?'Your one-off payment succeeded, but recurring setup needs administrator attention. Please do not pay again.':['canceled','aborted','completed','cancelling'].includes(d.recurring)?'The recurring arrangement is '+d.recurring+'.':'Your recurring setup is still being confirmed.';
    show('Thank you — payment confirmed', 'Your one-off sandbox donation was successful. '+recurring+(d.fulfillmentPending?' Your confirmation email and any recurring setup are being prepared.':' A confirmation email is queued for the email address supplied at checkout.'), 'success');
    if(watch&&!watch.announced){if(!dialog.open)confirmedToast();watch.announced=true;saveWatch(watch);}
    retry.hidden=!d.fulfillmentPending;if(d.fulfillmentPending&&attempts++<75)timer=setTimeout(poll,4000);else if(!d.fulfillmentPending)saveWatch(null);
   }else if(d.status==='expired'){show('Checkout expired','No successful payment was confirmed for this checkout.','error');retry.hidden=true;}
   else {show('Confirming your payment', 'We are checking your payment with Stripe. This usually takes a few seconds. Please do not pay again.');if(attempts++<75)timer=setTimeout(poll,4000);else show('Confirmation is taking longer','Please check again shortly. Do not submit another payment while this one is being confirmed.');}
  }catch{show('Unable to check payment yet','Your payment may still have completed. Please use Check again; do not pay again.','error');if(attempts++<3)timer=setTimeout(poll,5000);}
  finally{busy=false;retry.disabled=false;}
 };
 retry.onclick=()=>{attempts=0;poll();};
 if(id){show('Confirming your payment','We are checking your payment with Stripe. Please do not pay again.');if(returnedId&&!watch?.dismissed)dialog.showModal();poll();}
 else{show('Checkout cancelled','You returned without completing this checkout. No successful payment has been confirmed.');retry.hidden=true;dialog.showModal();}
}

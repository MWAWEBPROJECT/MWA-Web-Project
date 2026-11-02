const form=document.getElementById('donation-form');
const notice=document.createElement('p');notice.className='tiny';notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');form.append(notice);
let requestId=null,lastPayload=null;
form.onsubmit=async event=>{
 event.preventDefault();if(!form.reportValidity())return;
 const recurringOptIn=document.getElementById('recurring-opt-in').checked;
 const payload={fund:document.getElementById('fund').value,amount:document.getElementById('amount').value,recurringOptIn,recurring:recurringOptIn?{amount:document.getElementById('recurring-amount').value,frequency:document.getElementById('recurring-frequency').value,firstDate:document.getElementById('recurring-first-date').value}:null};
 const fingerprint=JSON.stringify(payload);if(lastPayload!==fingerprint){requestId=crypto.randomUUID();lastPayload=fingerprint;}
 if(recurringOptIn&&!confirm(`Sandbox donation: $${payload.amount} once now, plus $${payload.recurring.amount} ${payload.recurring.frequency} starting ${payload.recurring.firstDate}.\n\nYou authorise the additional recurring test payments until cancelled. If the start date is today, both charges are due today. No real money moves. Continue?`))return;
 const button=form.querySelector('button[type="submit"]');button.disabled=true;notice.textContent='Opening secure Stripe test checkout…';
 try{const response=await fetch('/api/donations/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId})});const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to open checkout.');const url=new URL(result.url);if(url.origin!=='https://checkout.stripe.com')throw Error('Unexpected checkout address.');location.assign(url.href);}
 catch(error){notice.textContent=error.message;button.disabled=false;}
};
const query=new URLSearchParams(location.search);
if(query.has('donation_cancelled'))notice.textContent='Checkout was cancelled. No donation confirmation was recorded here; you can try again.';
const id=query.get('donation_result');
if(id){
 notice.tabIndex=-1;notice.focus();let attempts=0;
 const poll=async()=>{try{const response=await fetch('/api/donations/status?id='+encodeURIComponent(id));const d=await response.json();if(!response.ok)throw Error(d.error);
 if(d.status==='paid'){notice.textContent='Your one-off sandbox payment succeeded. No real money was charged. '+(d.recurring==='scheduled'||d.recurring==='active'?'Your additional recurring test donation is scheduled.':d.recurring==='needs_attention'?'Recurring setup needs administrator attention. Do not repeat the one-off payment.':d.recurring?'Recurring setup is being confirmed.':'No recurring donation was selected.')+' Confirmation email is queued for admin@muhammadiwelfare.org.au.';if(d.recurring==='not_started'&&attempts++<45)setTimeout(poll,4000);return;}
 notice.textContent=d.status==='expired'?'This checkout expired. No successful payment was confirmed.':'Confirming your sandbox payment with Stripe. This may take a few minutes. Please do not pay again.';
 if(d.status!=='expired'&&attempts++<45)setTimeout(poll,4000);
 }catch{notice.textContent='Payment status is temporarily unavailable. Please do not pay again; refresh this page to check.';}};poll();
}

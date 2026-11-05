const crypto=require('node:crypto');
const OWNER='admin@muhammadiwelfare.org.au',INFO='info@muhammadiwelfare.org.au',SITE='https://mwa-community-web.web.app';
const STATES=['new','in_progress','awaiting_visitor','resolved','spam'];
const TOPICS=['General enquiry','Community feedback','Volunteering','Membership','Tutoring'];
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function fault(status,message){return Object.assign(new Error(message),{status});}
function text(value,label,max,min=1){if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw fault(400,`Check ${label}.`);return value.trim();}
function email(value){const e=text(value,'your email address',254).toLowerCase();if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(e))throw fault(400,'Enter a valid email address.');return e;}
function submission(input={}){if(input.website)throw fault(400,'The form could not be submitted.');const name=text(input.name,'your name',120),address=email(input.email),topic=TOPICS.includes(input.topic)?input.topic:'General enquiry',body=text(input.message,'your message',10000,5),key=text(input.requestId,'the submission reference',64);if(!/^[a-zA-Z0-9_-]{16,64}$/.test(key))throw fault(400,'Reload the form and try again.');return {name,email:address,topic,body,key};}
function messageInput(input={}){const kind=input.kind==='note'?'note':'reply';return {kind,body:text(input.body,'the message',10000),requestId:text(input.requestId,'the message reference',64)};}
function headers(payload,name){return (payload.headers||[]).filter(h=>h.name?.toLowerCase()===name.toLowerCase()).map(h=>String(h.value||''));}
function header(payload,name){return headers(payload,name)[0]||'';}
function sender(value){const match=value.match(/<([^<>]+)>/);try{return email(match?match[1]:value)}catch{return '';}}
function decode(data){try{return Buffer.from(data||'','base64url').toString('utf8')}catch{return '';}}
function mailText(payload){let plain=[],html=[],files=[];function walk(part){if(part.filename)files.push(String(part.filename).slice(0,200));else if(part.mimeType==='text/plain'&&part.body?.data)plain.push(decode(part.body.data));else if(part.mimeType==='text/html'&&part.body?.data)html.push(decode(part.body.data));for(const child of part.parts||[])walk(child);}walk(payload);const original=(plain.join('\n')||html.join('\n').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')).slice(0,50000);const short=original.split(/\nOn [^\n]{0,250}wrote:\s*\n|\n-{2,}\s*Original Message\s*-{2,}\n/i)[0].split('\n').filter(line=>!/^\s*>/.test(line)).join('\n').trim();return {body:short||original.trim()||'(No text content. This email may contain attachments.)',originalText:original,attachments:files};}
function hasTrustedAlignedDmarc(payload,address){
 const results=headers(payload,'Authentication-Results');
 if(results.length!==1)return false;
 const [receiver,...checks]=results[0].split(';');
 if(receiver.trim().toLowerCase()!=='mx.google.com')return false;
 const dmarc=checks.find(check=>/^\s*dmarc=pass\b/i.test(check));
 const aligned=dmarc?.match(/\bheader\.from=([a-z0-9.-]+)\b/i)?.[1]?.toLowerCase();
 return !!aligned&&aligned===address.split('@')[1];
}
function inboundDecision(thread,message){const p=message.payload||{},from=sender(header(p,'From'));if(from===OWNER||message.labelIds?.includes('SENT')||message.labelIds?.includes('DRAFT'))return 'ignore';if(header(p,'Auto-Submitted')&&header(p,'Auto-Submitted').toLowerCase()!=='no')return 'ignore';if(/bulk|list|junk/i.test(header(p,'Precedence')))return 'ignore';if(thread.status==='spam')return 'suppressed';if(from!==thread.email||!hasTrustedAlignedDmarc(p,from))return 'review';return 'accept';}
function rfcId(jobId){return `<mwa-enquiry-${hash(jobId).slice(0,40)}@muhammadiwelfare.org.au>`;}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function rawEmail({to,subject,body,messageId,inReplyTo,references,buttonUrl}){
 const safe=s=>String(s||'').replace(/[\r\n]/g,'');
 const lines=[`From: Muhammadi Welfare Association <${OWNER}>`,`To: ${email(to)}`,`Reply-To: ${OWNER}`,`Subject: =?UTF-8?B?${Buffer.from(safe(subject)).toString('base64')}?=`,`Message-ID: ${safe(messageId)}`,'MIME-Version: 1.0'];
 if(inReplyTo)lines.push('In-Reply-To: '+safe(inReplyTo));if(references)lines.push('References: '+safe(references));
 const encode=value=>(Buffer.from(value).toString('base64').match(/.{1,76}/g)||[]).join('\r\n');let content;
 if(buttonUrl&&buttonUrl.startsWith(SITE+'/enquiries/?thread=')){const boundary='mwa_'+hash(messageId).slice(0,24);lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);const html=`<html><body style="font-family:Arial,sans-serif;color:#173b30;padding:24px"><h2>Muhammadi Welfare Association</h2><div style="white-space:pre-wrap">${escapeHtml(body)}</div><p><a style="background:#173b30;color:white;padding:14px 22px;display:inline-block;border-radius:8px;text-decoration:none" href="${escapeHtml(buttonUrl)}">Open enquiry &amp; respond</a></p><p>Approved Admin Team sign-in required.</p></body></html>`;content=`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encode(body)}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encode(html)}\r\n--${boundary}--`;}else{lines.push('Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64');content=encode(body);}
 return Buffer.from(lines.join('\r\n')+'\r\n\r\n'+content).toString('base64url');
}
function audit(db,tx,actor,id,action,note='',diff=null){tx.set(db.collection('auditLog').doc(),{module:'enquiries',entityType:'enquiry',entityId:id,action,userId:actor?.uid||null,userEmail:actor?.email||null,note,diff,timestamp:new Date().toISOString()});}
function notifyJob(thread,id,reason){return {threadId:id,kind:'notification',buttonUrl:SITE+'/enquiries/?thread='+id,to:INFO,subject:`${reason}: ${thread.reference}`,body:`${reason}\n\nReference: ${thread.reference}\nFrom: ${thread.name} <${thread.email}>\nTopic: ${thread.topic}\n\nOpen enquiry and respond (approved admin sign-in required):\n${SITE}/enquiries/?thread=${id}\n\nPlease respond from the dashboard.`,status:'queued',attempts:0,nextAttemptAt:new Date().toISOString(),createdAt:new Date().toISOString()};}
module.exports={OWNER,INFO,SITE,STATES,TOPICS,hash,fault,text,email,submission,messageInput,headers,header,sender,mailText,hasTrustedAlignedDmarc,inboundDecision,rfcId,rawEmail,audit,notifyJob};

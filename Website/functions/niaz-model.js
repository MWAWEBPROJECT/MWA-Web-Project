const {createHash}=require('node:crypto');
const {mobile,validDate,dateKey,publicEvent}=require('./donation-records');
const fault=(status,message)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
function text(value,label,max=200,required=false){
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fault(400,'Check '+label+'.');
 return value.trim();
}
function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))throw fault(400,'Choose a valid reference.');return value;}
function choice(value,allowed,label){if(!allowed.includes(value))throw fault(400,'Choose '+label+'.');return value;}
function email(value){const v=text(value||'','email',254).toLowerCase();if(v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw fault(400,'Enter a valid email.');return v;}
function sponsor(input){
 const name=text(input.name,'sponsor name',160,true),contactEmail=email(input.email),phone=mobile(text(input.phone||'','phone',30));
 if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone))throw fault(400,'Enter a valid international or Australian mobile.');
 if(!contactEmail&&!phone)throw fault(400,'Provide a sponsor email or phone for duplicate checking.');
 if(input.memberId)throw fault(412,'Member linking is unavailable until an authoritative membership adapter is configured. Do not infer membership from a supplied ID.');
 if(typeof input.publicConsent!=='boolean')throw fault(400,'Choose whether the name may be displayed publicly.');
 return {name,email:contactEmail,phone,active:input.active!==false,publicConsent:input.publicConsent,consentVersion:'niaz-2026-11-v1',notes:text(input.notes||'','notes',2000)};
}
function sponsorKey(value){return hash('contact:'+ (value.email?'email:'+value.email:'phone:'+value.phone));}
function contactKeys(value){return [...new Set([value.email?sponsorKey({email:value.email}):null,value.phone?sponsorKey({phone:value.phone}):null].filter(Boolean))];}
function assignmentKey(sponsorId,eventId,origin='coordinator'){return hash([sponsorId,eventId,origin].join(':'));}
function assignment(input){
 const type=choice(input.type,['one_time','annual','permanent'],'a sponsorship type');
 const seriesId=input.seriesId?id(input.seriesId):'';
 if(type==='permanent'&&!seriesId)throw fault(400,'Permanent sponsorship requires a stable calendar series reference.');
 return {type,seriesId,role:choice(input.role||'joint',['sole','joint','contributor'],'a sponsor role'),inKind:text(input.inKind||'','in-kind provision',1000),notes:text(input.notes||'','arrangement notes',2000)};
}
function eligible(event,eventId){return !!publicEvent(event,eventId)&&String(event.departmentName||'').trim().toLowerCase()==='mwa programs';}
function annualYear(value){if(!Number.isInteger(value)||value<2020||value>2100)throw fault(400,'Choose a valid calendar year.');return value;}
function amount(value){if(!Number.isSafeInteger(value)||value<0||value>100000000)throw fault(400,'Enter a valid non-negative AUD amount in cents.');return value;}
function badges(assignments,coverage={}){
 const approved=assignments.filter(a=>a.status==='approved');
 const result=[];
 result.push(approved.length>1?'Jointly sponsored':approved.length?'Sponsored':'No sponsor');
 if(coverage.pendingEOIs)result.push('EOI pending');
 if(coverage.confirmedCents>0&&coverage.targetCents>0)result.push(coverage.confirmedCents>=coverage.targetCents?'Fully funded':'Partially funded');
 if(coverage.mwaArranged)result.push('MWA arranged');
 if(coverage.arrangementConfirmed)result.push('Arrangement confirmed');
 return result;
}
function publicSponsor(sponsor,assignment){
 if(assignment.status!=='approved'||!sponsor?.active)return null;
 return {name:sponsor.publicConsent?sponsor.name:'Private sponsor',type:assignment.type,role:assignment.role};
}
function importRow(row){
 const value=sponsor({...row,publicConsent:row.publicConsent===true||row.publicConsent==='true'});
 if(!validDate(row.eventDate))throw fault(400,'Choose a valid event date (YYYY-MM-DD).');
 return {...value,eventDate:row.eventDate,eventId:row.eventId?id(row.eventId):'',...assignment(row)};
}
function donationEntry(record,idValue){
 if(record.fund!=='Niaz Contribution'||record.niaz?.scope!=='event'||record.donationMode==='recurring_only')return null;
 const paid=record.status==='paid'||!!record.paymentVerifiedAt;
 const gross=paid?amount(record.amount):0,refund=record.refundedCents==null?0:amount(record.refundedCents);
 if(refund>gross)throw fault(409,'Donation reversal exceeds verified payment; reconciliation required.');
 return {transactionId:id(idValue),eventId:id(record.niaz.eventId),grossCents:gross,refundedCents:refund,netCents:Math.max(0,gross-refund),sandbox:true};
}
function dueNotices(event,now=new Date(),followup=false){
 if(!event||event.status!=='confirmed'||!Number.isFinite(Date.parse(event.startAt)))return [];
 const date=dateKey(event.startAt),today=dateKey(now),difference=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
 return difference===7?['seven-day']:followup&&difference===3?['three-day']:[];
}
module.exports={fault,hash,text,id,choice,email,sponsor,sponsorKey,contactKeys,assignmentKey,assignment,eligible,annualYear,amount,badges,publicSponsor,importRow,donationEntry,dueNotices};

const crypto=require('node:crypto');

const METHODS=new Set(['email','mobile']);
const string=(value,max,label,required=false)=>{
 if(typeof value!=='string')throw new Error(`${label} must be text.`);
 const normalized=value.trim();
 if((required&&!normalized)||normalized.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(normalized))throw new Error(`Check ${label}.`);
 return normalized;
};

function normalizeEmail(value){
 const email=string(value,254,'contact email',true).toLowerCase();
 if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw new Error('Enter a valid contact email.');
 return email;
}

function normalizePhone(value){
 let phone=string(value,24,'mobile number',true).replace(/[ ()-]/g,'');
 if(/^04\d{8}$/.test(phone))phone='+61'+phone.slice(1);
 if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Enter a mobile number such as 0412 345 678 or +61 412 345 678.');
 return phone;
}

function selectedContact(method,data){
 if(!METHODS.has(method))throw new Error('Choose email or mobile verification.');
 return method==='email'?normalizeEmail(data.contactEmail):normalizePhone(data.contactPhone);
}

function canonicalBookingPayload(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Booking details are required.');
 const start=new Date(string(data.startAt,40,'start time',true));
 const end=new Date(string(data.endAt,40,'end time',true));
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)throw new Error('Check the booking date and time.');
 const basis=data.dateBasis==='h'||data.dateBasis==='hijri'?'h':'g';
 const hijri=data.hijriDate&&typeof data.hijriDate==='object'&&!Array.isArray(data.hijriDate)
  ?{day:Number(data.hijriDate.day),month:Number(data.hijriDate.month),year:Number(data.hijriDate.year)}:null;
 if(basis==='h'&&(!hijri||!Number.isInteger(hijri.day)||hijri.day<1||hijri.day>30||!Number.isInteger(hijri.month)||hijri.month<1||hijri.month>12||!Number.isInteger(hijri.year)||hijri.year<1300||hijri.year>1600))throw new Error('Check the Hijri date.');
 const prayer=value=>value&&typeof value==='object'&&!Array.isArray(value)?{key:string(value.key,30,'prayer',true),offset:Number(value.offset)||0}:null;
 const contactEmail=typeof data.contactEmail==='string'&&data.contactEmail.trim()?normalizeEmail(data.contactEmail):'';
 return {
  title:string(data.title,200,'title',true),
  departmentId:string(data.departmentId,200,'booking type',true),
  venueId:string(data.venueId,200,'venue',true),
  startAt:start.toISOString(),
  endAt:end.toISOString(),
  dateBasis:basis,
  hijriDate:basis==='h'?hijri:null,
  timeMode:['allDay','allNight'].includes(data.timeMode)?data.timeMode:'custom',
  speakerName:string(data.speakerName||'',200,'speaker name'),
  programDetails:string(data.programDetails||'',2000,'program details'),
  startPrayer:prayer(data.startPrayer),
  endPrayer:prayer(data.endPrayer),
  contactName:string(data.contactName,200,'contact name',true),
  contactEmail,
  contactPhone:string(data.contactPhone||'',50,'contact phone'),
  notes:string(data.notes||'',2000,'notes'),
  visibility:data.visibility==='private'?'private':'public'
 };
}

function payloadDigest(payload){
 return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function newChallengeId(){return crypto.randomBytes(32).toString('base64url');}
function newEmailCode(){return String(crypto.randomInt(100000,1000000));}
function codeVerifier(secret,challengeId,code){
 if(typeof secret!=='string'||secret.length<32)throw new Error('Email verification is not configured.');
 return crypto.createHmac('sha256',secret).update(`public-booking\0${challengeId}\0${code}`).digest('hex');
}
function equalVerifier(left,right){
 const a=Buffer.from(String(left||''),'hex'),b=Buffer.from(String(right||''),'hex');
 return a.length===b.length&&a.length===32&&crypto.timingSafeEqual(a,b);
}
function timestampMillis(value){
 if(value&&typeof value.toMillis==='function')return value.toMillis();
 const numeric=Number(value);
 return Number.isFinite(numeric)?numeric:NaN;
}
function isVerifiedChallenge(challenge,{method,contact,payload,sessionIdHash,now=Date.now()}){
 return !!challenge&&challenge.purpose==='public-booking'&&challenge.status==='verified'&&
  METHODS.has(challenge.method)&&challenge.method===method&&challenge.contact===contact&&
  challenge.sessionIdHash===sessionIdHash&&timestampMillis(challenge.expiresAt)>now&&
  (challenge.scope==='contact'||challenge.payloadDigest===payloadDigest(payload));
}
function canReplay(record,{sessionIdHash,payload,now=Date.now()}){
 return !!record&&typeof record.eventId==='string'&&record.eventId.length>0&&
  record.sessionIdHash===sessionIdHash&&timestampMillis(record.expiresAt)>now&&
  record.payloadDigest===payloadDigest(payload);
}
function rateLimitId(secret,kind,value){
 if(typeof secret!=='string'||secret.length<32)throw new Error('Booking verification is not configured.');
 return crypto.createHmac('sha256',secret).update(`booking-rate\0${kind}\0${String(value).trim().toLowerCase()}`).digest('hex');
}

function maskContact(method,value){
 if(method==='email'){
  const [local,domain]=value.split('@');
  return `${local.slice(0,1)}${'*'.repeat(Math.max(2,Math.min(8,local.length-1)))}@${domain}`;
 }
 return `${value.slice(0,4)}${'•'.repeat(Math.max(0,value.length-8))}${value.slice(-4)}`;
}

module.exports={
 METHODS,normalizeEmail,normalizePhone,selectedContact,canonicalBookingPayload,payloadDigest,
 newChallengeId,newEmailCode,codeVerifier,equalVerifier,isVerifiedChallenge,canReplay,
 rateLimitId,maskContact
};

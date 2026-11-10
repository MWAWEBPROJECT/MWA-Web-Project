export function contactInput(method,value){
 return method==='mobile'?String(value).replace(/\D/g,'').slice(0,15):String(value).slice(0,254);
}
export function verificationPhone(value){
 let phone=String(value||'').trim().replace(/[ ()-]/g,'');
 if(/^04\d{8}$/.test(phone))phone='+61'+phone.slice(1);
 else if(/^[1-9]\d{7,14}$/.test(phone))phone='+'+phone;
 if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Enter an Australian 04 mobile number or an international number including its country code (for example 61412345678).');
 return phone;
}
export function contactError(method,value){
 if(method==='mobile'){
  try{verificationPhone(value);return '';}catch{return 'Enter a valid mobile number, including the country code for international numbers.';}
 }
 const email=String(value||'').trim();
 return email.length<=254&&/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)?'':'Enter a valid email address.';
}

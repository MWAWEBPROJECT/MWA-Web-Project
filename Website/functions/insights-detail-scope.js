const {isOwner,normalizeEmail}=require('./adminAccess');

const refPattern=/^[A-Za-z0-9_-]{1,128}$/;
const formPattern=/^[a-f0-9-]{36}$/;
const fault=(status,message)=>Object.assign(Error(message),{status});

function cleanScope(input){
 const formIds=input?.formIds,eventIds=input?.eventIds;
 if(!Array.isArray(formIds)||!Array.isArray(eventIds)||formIds.length>30||eventIds.length>30||
    formIds.some(id=>typeof id!=='string'||!formPattern.test(id))||
    eventIds.some(id=>typeof id!=='string'||!refPattern.test(id))||
    new Set(formIds).size!==formIds.length||new Set(eventIds).size!==eventIds.length||
    (!formIds.length&&!eventIds.length))throw fault(400,'Choose at least one valid form or event, without duplicates.');
 return {formIds:[...formIds].sort(),eventIds:[...eventIds].sort()};
}

function activeGrant(grant,actor,expectedRevision,now=Date.now()){
 if(isOwner(actor?.email))return expectedRevision===null;
 return !!grant&&grant.revoked===false&&grant.uid===actor?.uid&&
  (grant.permission===undefined||grant.permission==='view'||grant.permission==='export')&&
  normalizeEmail(grant.email)===normalizeEmail(actor?.email)&&
  Number.isSafeInteger(grant.revision)&&grant.revision>0&&grant.revision===expectedRevision&&
  Number.isFinite(Date.parse(grant.expiresAt))&&Date.parse(grant.expiresAt)>now;
}

function matches(scope,formId,savedEventId){
 return (!scope.formIds.length||scope.formIds.includes(formId))&&
  (!scope.eventIds.length||scope.eventIds.includes(savedEventId));
}

function projectResponse(formId,id,response,{includeEventId=false}={}){
 if(!response||!Array.isArray(response.fields)||!response.answers||typeof response.answers!=='object'||
    Array.isArray(response.answers)||!Number.isFinite(Date.parse(response.createdAt))||
    !Number.isSafeInteger(response.revision)||response.revision<1)throw fault(422,'A response has an unavailable or invalid saved snapshot. No complete export can be prepared.');
 const ids=new Set(),fields=response.fields.map(field=>{
  if(!field||typeof field.id!=='string'||!refPattern.test(field.id)||['__proto__','prototype','constructor'].includes(field.id)||ids.has(field.id)||
     typeof field.type!=='string'||typeof field.label!=='string'||
     (field.description!==undefined&&typeof field.description!=='string')||
     (field.terms!==undefined&&typeof field.terms!=='string')||
     (field.options!==undefined&&(!Array.isArray(field.options)||field.options.some(option=>typeof option!=='string'))))throw fault(422,'A response has an unavailable or invalid saved snapshot. No complete export can be prepared.');
  ids.add(field.id);
  return {id:field.id,type:field.type,label:field.label,description:field.description||'',required:field.required===true,options:field.options||[],terms:field.terms||''};
 });
 if(Object.keys(response.answers).some(id=>!ids.has(id)))throw fault(422,'A response has answers without a saved question definition. No complete export can be prepared.');
 if(Object.values(response.answers).some(value=>value!==null&&typeof value!=='string'&&typeof value!=='boolean'&&typeof value!=='number'&&
    !(Array.isArray(value)&&value.every(item=>typeof item==='string'))))throw fault(422,'A response has an invalid saved answer. No complete export can be prepared.');
 const answers=Object.fromEntries(fields.filter(field=>Object.hasOwn(response.answers,field.id)).map(field=>[field.id,response.answers[field.id]]));
 return {id,formId,reference:response.reference,formTitle:response.formTitle,purpose:response.purpose,
  createdAt:response.createdAt,revision:response.revision,fields,answers,
  eventId:includeEventId?response.eventId||'':'',editRevision:response.editRevision||0,editedAt:response.editedAt||null};
}

module.exports={cleanScope,activeGrant,matches,projectResponse};

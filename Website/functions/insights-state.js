const {createHash}=require('node:crypto');
const VERSION_SHARDS=64;
const shardFor=formId=>createHash('sha256').update(String(formId)).digest().readUInt32BE(0)%VERSION_SHARDS;
const shardId=value=>String(value).padStart(2,'0');
const versionRef=(db,kind,formId)=>db.doc(`_insightsState/${kind}Versions/markers/${shardId(shardFor(formId))}`);
const formsVersionRef=db=>db.doc('_insightsState/formsVersion');
async function bumpVersionTx(tx,db,kind,formId){
 const ref=versionRef(db,kind,formId),snap=await tx.get(ref);
 tx.set(ref,{generation:(snap.data()?.generation||0)+1,updatedAt:new Date().toISOString()});
}
async function bumpSourceVersionTx(tx,db,formId){return bumpVersionTx(tx,db,'source',formId);}
async function bumpIndexVersionTx(tx,db,formId){return bumpVersionTx(tx,db,'index',formId);}
async function bumpFormsVersionTx(tx,db){
 const ref=formsVersionRef(db),snap=await tx.get(ref);
 tx.set(ref,{generation:(snap.data()?.generation||0)+1,updatedAt:new Date().toISOString()});
}
async function recordSourceChange(db,formId){
 await db.runTransaction(async tx=>bumpSourceVersionTx(tx,db,formId));
}
async function recordFormCatalogChange(db){
 await db.runTransaction(async tx=>bumpFormsVersionTx(tx,db));
}
function versionRefs(db,kind){
 return Array.from({length:VERSION_SHARDS},(_,index)=>db.doc(`_insightsState/${kind}Versions/markers/${shardId(index)}`));
}
async function readGenerations(db,kind){
 const refs=versionRefs(db,kind),values=[];
 for(let offset=0;offset<refs.length;offset+=500){
  const docs=await db.getAll(...refs.slice(offset,offset+500));
  values.push(...docs.map(doc=>doc.data()?.generation||0));
 }
 return values;
}
async function readFormsGeneration(db){
 return (await formsVersionRef(db).get()).data()?.generation||0;
}
module.exports={VERSION_SHARDS,shardFor,versionRef,formsVersionRef,bumpSourceVersionTx,bumpIndexVersionTx,bumpFormsVersionTx,recordSourceChange,recordFormCatalogChange,versionRefs,readGenerations,readFormsGeneration};

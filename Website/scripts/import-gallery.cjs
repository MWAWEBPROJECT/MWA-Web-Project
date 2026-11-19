'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{createHash}=require('node:crypto');
const Images=require('../functions/gallery-storage'),root=path.resolve(__dirname,'../..'),project='project-7a4fb531-414f-4ade-88e';
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'gallery-import-manifest.json'),'utf8'));
const cache=path.join(process.env.TEMP||'/tmp','mwa-gallery-source-cache'),base='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents/galleryPhotos/';
const shell=s=>cp.execSync(s,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const secret=n=>shell('gcloud secrets versions access latest --secret='+n+' --project='+project+' --account=admin@muhammadiwelfare.org.au');
const field=v=>v===null?{nullValue:null}:typeof v==='number'?{integerValue:String(v)}:{stringValue:String(v)};
async function main(){
 const apply=process.argv.includes('--apply'),sources=manifest.sourceUrls.map((url,i)=>({url,filename:path.join(cache,String(i).padStart(3,'0')+'.img'),category:manifest.categoryByUrl[url]||'Community'}));
 sources.push(...manifest.existingLocalPhotos.map((name,i)=>({url:null,filename:path.join(root,name),category:'Community',local:i+1})));
 const distinct=new Map();for(const item of sources){if(!fs.existsSync(item.filename))throw Error('Source cache or local photograph missing.');const bytes=fs.readFileSync(item.filename),id=createHash('sha256').update(bytes).digest('hex');if(!distinct.has(id))distinct.set(id,{...item,bytes,id});}
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',sources:sources.length,unique:distinct.size,duplicates:sources.length-distinct.size}));if(!apply)return;
 const account=fs.readFileSync(path.join(root,'Website/functions/.env.'+project),'utf8').match(/^MWA_R2_ACCOUNT_ID=([a-f0-9]{32})/m)?.[1];if(!account)throw Error('R2 account configuration missing.');
 const store=Images.storage({MWA_R2_ACCOUNT_ID:account,MWA_GALLERY_R2_BUCKET:'mwa-gallery',MWA_GALLERY_R2_ACCESS_KEY_ID:secret('MWA_GALLERY_R2_ACCESS_KEY_ID'),MWA_GALLERY_R2_SECRET_ACCESS_KEY:secret('MWA_GALLERY_R2_SECRET_ACCESS_KEY')});
 const token=shell('gcloud auth print-access-token --account=sajjadzaheer@gmail.com'),headers={Authorization:'Bearer '+token};let created=0,skipped=0,failed=[];
 for(const [i,item] of [...distinct.values()].entries())try{
  const url=base+item.id,old=await fetch(url,{headers});if(old.ok){skipped++;continue}if(old.status!==404)throw Error('Metadata lookup HTTP '+old.status);
  const type=(item.url||item.filename).toLowerCase().split('?')[0].endsWith('.png')?'image/png':'image/jpeg',image=await Images.prepare(item.bytes,type);
  await store.put(item.id,'original',image.original,type);await store.put(item.id,'preview',image.preview);await store.put(item.id,'thumb',image.thumb);
  const values={title:item.local?'MWA community photograph '+item.local:item.category+' photograph '+String(i+1).padStart(2,'0'),caption:'',event:'',category:item.category,tags:'',date:null,visibility:'public',type,width:image.width,height:image.height,state:'ready',revision:1,createdAt:new Date().toISOString(),updatedBy:'official-gallery-import',sourceUrl:item.url||'existing-refreshed-website'};
  const body={fields:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,field(v)]))},saved=await fetch(url,{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!saved.ok)throw Error('Metadata save HTTP '+saved.status);created++;
 }catch(e){failed.push({index:i,error:e.message})}finally{if((i+1)%10===0||i+1===distinct.size)console.log(JSON.stringify({processed:i+1,total:distinct.size,created,skipped,failed:failed.length}));}
 console.log(JSON.stringify({result:{created,skipped,failed}}));if(failed.length)process.exitCode=1;
}
main().catch(e=>{console.error('Gallery import stopped:',e.message);process.exitCode=1});

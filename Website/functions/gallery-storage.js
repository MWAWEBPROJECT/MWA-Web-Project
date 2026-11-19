'use strict';
const {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
const sharp=require('sharp');
const {createHash}=require('node:crypto');
const MAX_BYTES=5*1024*1024,MAX_PIXELS=40000000;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function configuration(env=process.env){
 const account=env.MWA_R2_ACCOUNT_ID,bucket=env.MWA_GALLERY_R2_BUCKET||'mwa-gallery';
 const accessKeyId=env.MWA_GALLERY_R2_ACCESS_KEY_ID,secretAccessKey=env.MWA_GALLERY_R2_SECRET_ACCESS_KEY;
 if(!/^[a-f0-9]{32}$/.test(account||'')||bucket!=='mwa-gallery'||!accessKeyId||!secretAccessKey)fail(503,'Gallery storage is not configured.');
 return {bucket,client:new S3Client({region:'auto',endpoint:`https://${account}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey}})};
}
function objectKey(id,variant){if(!/^[a-f0-9]{64}$/.test(id)||!['original','preview','thumb'].includes(variant))fail(400,'Invalid gallery image.');return `${variant}s/${id}${variant==='original'?'':'.webp'}`;}
async function prepare(bytes,type){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_BYTES)fail(400,'Choose an image up to 5 MB.');
 if(!['image/jpeg','image/png','image/webp'].includes(type))fail(400,'Choose a JPEG, PNG or WebP image.');
 try{
  const input=sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'error'}),m=await input.metadata();
  if(!['jpeg','png','webp'].includes(m.format)||type!==`image/${m.format}`||(m.pages||1)!==1||!m.width||!m.height||m.width*m.height>MAX_PIXELS)fail(400,'Choose a single photograph up to 40 megapixels.');
  const make=async size=>{
   const base=await sharp(bytes,{limitInputPixels:MAX_PIXELS}).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
   const dim=await sharp(base).metadata(),w=dim.width,h=dim.height,bar=Math.max(12,Math.round(h*.075)),font=Math.max(7,Math.min(bar*.43,w/28));
   const mark=Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="${h-bar}" width="${w}" height="${bar}" fill="#102f25" fill-opacity="0.78"/><text x="${w/2}" y="${h-bar/2}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${font}" fill="white">MWA · Preview</text></svg>`);
   return sharp(base).composite([{input:mark}]).webp({quality:82}).toBuffer();
  };
  const [preview,thumb]=await Promise.all([make(1600),make(480)]);
  const d=await sharp(preview).metadata();
  return {id:createHash('sha256').update(bytes).digest('hex'),original:bytes,preview,thumb,type,width:d.width,height:d.height};
 }catch(e){if(e.status)throw e;fail(400,'This photograph could not be decoded. Choose a valid JPEG, PNG or WebP.');}
}
function storage(env=process.env){
 const {bucket,client}=configuration(env);
 return {
  async put(id,variant,body,type='image/webp'){await client.send(new PutObjectCommand({Bucket:bucket,Key:objectKey(id,variant),Body:body,ContentType:type,CacheControl:'private, no-store'}));},
  async get(id,variant){const r=await client.send(new GetObjectCommand({Bucket:bucket,Key:objectKey(id,variant)}));if(r.ContentLength>MAX_BYTES)fail(503,'Stored image exceeds size limit.');let size=0;const parts=[];for await(const chunk of r.Body){size+=chunk.length;if(size>MAX_BYTES)fail(503,'Stored image exceeds size limit.');parts.push(chunk);}return Buffer.concat(parts);},
  async remove(id,variant){await client.send(new DeleteObjectCommand({Bucket:bucket,Key:objectKey(id,variant)}));}
 };
}
module.exports={MAX_BYTES,MAX_PIXELS,configuration,objectKey,prepare,storage};

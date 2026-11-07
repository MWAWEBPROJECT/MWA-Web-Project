const {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
const sharp=require('sharp');
const {randomUUID}=require('node:crypto');

const MAX_BYTES=2*1024*1024;
const MAX_PIXELS=16000000;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const newKey=formId=>`registration-posters/${formId}/${randomUUID()}.webp`;

function configuration(env=process.env){
 const account=env.MWA_R2_ACCOUNT_ID,bucket=env.MWA_R2_POSTER_BUCKET,accessKeyId=env.MWA_R2_ACCESS_KEY_ID,secretAccessKey=env.MWA_R2_SECRET_ACCESS_KEY;
 if(!account||!bucket||!accessKeyId||!secretAccessKey)fail(503,'Poster storage is not configured. Contact the MWA administrator.');
 if(!/^[a-f0-9]{32}$/.test(account)||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))fail(503,'Poster storage configuration is invalid. Contact the MWA administrator.');
 return {bucket,client:new S3Client({region:'auto',endpoint:`https://${account}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey}})};
}

async function validateImage(input){
 if(!input||typeof input.data!=='string'||!['image/png','image/jpeg','image/webp'].includes(input.type)||input.data.length>Math.ceil(MAX_BYTES/3)*4+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail(400,'Choose a PNG, JPEG or WebP poster up to 2 MB.');
 const bytes=Buffer.from(input.data,'base64');
 if(!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==input.data)fail(400,'Choose a PNG, JPEG or WebP poster up to 2 MB.');
 let metadata,output;
 try{
  const image=sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'error'});
  metadata=await image.metadata();
  if(!['png','jpeg','webp'].includes(metadata.format)||input.type!==`image/${metadata.format}`||!metadata.width||!metadata.height||metadata.width>4096||metadata.height>4096||metadata.width*metadata.height>MAX_PIXELS||(metadata.pages||1)!==1)fail(400,'Choose a single PNG, JPEG or WebP image no larger than 4096 pixels per side or 16 megapixels.');
  output=await image.rotate().webp({quality:85}).toBuffer();
 }catch(error){if(error.status)throw error;fail(400,'The poster image could not be decoded. Choose a valid image.');}
 if(output.length>MAX_BYTES)fail(400,'The processed poster is larger than 2 MB. Choose a smaller image.');
 return output;
}

function storage(env=process.env){
 const {bucket,client}=configuration(env);
 async function request(command){
  try{return await client.send(command);}
  catch(error){console.error('R2 poster storage request failed:',error.name);fail(503,'Poster storage is temporarily unavailable. Please try again.');}
 }
 return {
  async put(key,body){await request(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:'image/webp'}));},
  async get(key){const result=await request(new GetObjectCommand({Bucket:bucket,Key:key}));if(result.ContentLength>MAX_BYTES)fail(503,'Stored poster exceeds its size limit.');const chunks=[];let size=0;for await(const chunk of result.Body){size+=chunk.length;if(size>MAX_BYTES)fail(503,'Stored poster exceeds its size limit.');chunks.push(chunk);}return Buffer.concat(chunks,size);},
  async remove(key){await request(new DeleteObjectCommand({Bucket:bucket,Key:key}));},
 };
}
module.exports={MAX_BYTES,validateImage,storage,configuration,newKey};

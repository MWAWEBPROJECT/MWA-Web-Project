const model=require('./content-model.json');
function validateContent(value){
 if(!value||typeof value!=='object'||value.schemaVersion!==1||!['green','navy','copper','teal','plum','slate'].includes(value.palette)||!['light','dark','system'].includes(value.mode)||typeof value.useCustomPrimary!=='boolean'||!/^#[0-9a-f]{6}$/i.test(value.customPrimary||''))return null;
 if(typeof value.logo!=='string'||value.logo.length>600000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.logo))return null;
 const bytes=Buffer.from(value.logo.split(',')[1],'base64');
 if(value.logo.startsWith('data:image/png;')&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return null;
 if(value.logo.startsWith('data:image/jpeg;')&&!bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return null;
 if(value.logo.startsWith('data:image/webp;')&&!(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'))return null;
 if(!value.content||typeof value.content!=='object'||Array.isArray(value.content))return null;
 const content={};for(const field of model.fields){const text=value.content[field.key]??((field.key.startsWith('tutoring_')||field.key.startsWith('service_')||field.key.startsWith('photo_'))?model.defaults.content[field.key]:undefined);if(typeof text!=='string'||text.length>2000||(!field.optional&&!text.trim()))return null;if(field.kind==='image'&&!require('./site-images').validPhoto(text))return null;if(field.kind==='url'){try{const u=new URL(text);if(!['https:','mailto:'].includes(u.protocol)||/[\r\n]/.test(text))return null}catch{return null}}if(field.kind==='email'&&text&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))return null;content[field.key]=text}
 const result={schemaVersion:1,content,logo:value.logo,palette:value.palette,mode:value.mode,customPrimary:value.customPrimary,useCustomPrimary:value.useCustomPrimary};return Buffer.byteLength(JSON.stringify(result))<800000?result:null;
}
module.exports={validateContent};

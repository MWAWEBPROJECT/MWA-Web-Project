import {createHash} from 'node:crypto';

export function externaliseImages(html,emit){
 return html.replace(/(<img\b[^>]*\bsrc=")data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)(")/g,(_,before,type,data,after)=>{
  const bytes=Buffer.from(data,'base64');
  const name=`assets/embedded-${createHash('sha256').update(bytes).digest('hex').slice(0,16)}.${type==='jpeg'?'jpg':type}`;
  emit(name,bytes);
  return before+'/'+name+after;
 });
}

export function embeddedImages(){
 return {name:'externalise-embedded-images',apply:'build',enforce:'post',generateBundle(_,bundle){
  const html=bundle['index.html'];
  if(!html||html.type!=='asset')throw Error('Website HTML output is missing.');
  const emitted=new Set();
  html.source=externaliseImages(String(html.source),(fileName,source)=>{
   if(!emitted.has(fileName)){this.emitFile({type:'asset',fileName,source});emitted.add(fileName);}
  });
 }};
}

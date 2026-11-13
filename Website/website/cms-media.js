// Shared static-photo rendering. URLs are constrained again on publication by the server.
export function validPhoto(value){if(typeof value!=='string'||/[\r\n\\]/.test(value))return false;if(value==='')return true;if(/^\/(?:images|assets)\/[a-zA-Z0-9_./-]+$/.test(value)&&!value.includes('..'))return true;if(/^\/api\/site-images\/[a-f0-9-]{36}$/.test(value))return true;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
window.mwaValidPhoto=validPhoto;
window.mwaApplyPhotos=config=>{
 if(config)window.MWA_PUBLIC_CONTENT=config.content;
 const content=window.MWA_PUBLIC_CONTENT||{};
 for(const img of document.querySelectorAll('img[data-cms-photo]')){
  const value=content[img.dataset.cmsPhoto];if(typeof value==='string'&&validPhoto(value)){if(value&&img.getAttribute('src')!==value)img.setAttribute('src',value);if(!value)img.removeAttribute('src');img.hidden=!value;}
  const alt=content[img.dataset.cmsAlt];if(typeof alt==='string')img.alt=alt;
 }
};
let scheduled=false;new MutationObserver(records=>{if(!records.some(r=>r.addedNodes.length)||scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;window.mwaApplyPhotos();});}).observe(document.body,{childList:true,subtree:true});

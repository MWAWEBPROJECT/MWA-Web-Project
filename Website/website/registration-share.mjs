export function formShareLinks(origin,form,ios=false){
 const url=new URL('/registrations/',origin);
 url.searchParams.set('form',form.id);url.searchParams.set('shared','1');
 const message=encodeURIComponent(form.title+'\n'+url.href);
 return {url:url.href,whatsapp:'https://wa.me/?text='+message,sms:'sms:'+(ios?'&':'?')+'body='+message};
}

export function adminReturnTarget(value){
 if(typeof value!=='string')return null;
 if(['/cms','/calendar-management/','/tools-automation/','/calendar/?view=admin'].includes(value))return value;
 if(/^\/calendar\/\?booking=[a-zA-Z0-9_-]{1,128}&decision=(approve|reject)$/.test(value))return value;
 if(/^\/enquiries\/(?:\?(?:thread=[a-f0-9]{32}|mailbox=setup))?$/.test(value))return value;
 return null;
}

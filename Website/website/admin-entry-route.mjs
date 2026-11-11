export function adminReturnTarget(value){
 if(typeof value!=='string')return null;
 if(/^\/admin-login\?module=(donations|form-builder|form-insights|insights-people|insights-detail|niaz)$/.test(value))return value;
 if(/^\/admin-login\?module=niaz&tab=(eois|dashboard|programmes|assignments|sponsors)$/.test(value))return value;
 if(value==='/admin-login?module=niaz&tools=notifications')return value;
 if(/^\/tools-automation\/\?tab=(team|audit)$/.test(value))return value;
 if(['/cms','/calendar-management/','/tools-automation/','/calendar/?view=admin'].includes(value))return value;
 if(/^\/calendar\/\?booking=[a-zA-Z0-9_-]{1,128}&decision=(approve|reject)$/.test(value))return value;
 if(/^\/enquiries\/(?:\?(?:thread=[a-f0-9]{32}|mailbox=setup))?$/.test(value))return value;
 return null;
}

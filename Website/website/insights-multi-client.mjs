export async function prepareMultiSnapshot({api,eventIds,programmeFilters,formId,isCurrent,onStart,onProgress,prefix='multi',input,stepInput,endpoint='/respondent'}){
 let status=await api(endpoint,{method:'POST',body:JSON.stringify({action:prefix+'-start',...(input||{eventIds,...programmeFilters,formId})})});
 const jobId=status.jobId;
 if(!isCurrent()){
  await api(endpoint,{method:'POST',body:JSON.stringify({action:prefix+'-cancel',jobId})});
  return '';
 }
 onStart(jobId);
 while(status.status==='running'){
  if(!isCurrent())return '';
  status=await api(endpoint,{method:'POST',body:JSON.stringify({action:prefix+'-step',jobId,step:status.step,...stepInput})});
  if(isCurrent())onProgress(status.scanned);
 }
 return isCurrent()?jobId:'';
}

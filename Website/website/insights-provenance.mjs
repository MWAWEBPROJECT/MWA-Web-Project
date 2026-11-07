export const INSIGHTS_PROVENANCE='Reports use indexed responses, which may lag source corrections. Event-date reports use the current calendar date for all indexed responses linked to an accessible event, not the event date at submission or a historical date. Responses with no accessible event or no current event date, including eventless responses, are excluded from event-date reports. Inventory also uses current calendar dates and excludes events without a current date; event names and status are current when available. Calendar changes are not checked by source/index reconciliation. Coverage remains incomplete.';

export function programmeFilterLabel(filters={}){
 return `programme categories ${(filters.categories||[]).join(', ')||'all'}; booking type ${filters.bookingType||'all'}; recurring series ${filters.series||'all'}`;
}
export function yearOverYear(days,filters){
 if(!Array.isArray(days)||!/^\d{4}-\d{2}-\d{2}$/.test(filters?.from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(filters?.to||''))return [];
 const start=Number(filters.from.slice(0,4)),end=Number(filters.to.slice(0,4)),result=[];
 if(end<start||end-start>10)return result;
 for(let year=start+1;year<=end;year++){
  const previous=String(year-1),current=String(year);
  let first=year-1===start?filters.from.slice(5):'01-01',last=year===end?filters.to.slice(5):'12-31';
  if(first==='02-29')first='03-01';
  if(last==='02-29')last='02-28';
  if(first>last)continue;
  let before=0,after=0;
  for(const item of days){
   const day=item.date.slice(5),itemYear=item.date.slice(0,4);
   if(day<first||day>last||day==='02-29')continue;
   if(itemYear===previous)before+=item.count;
   else if(itemYear===current)after+=item.count;
  }
  result.push({year:current,previousYear:previous,first,last,before,after,change:after-before,percent:before?(after-before)/before:null});
 }
 return result;
}
export function insightsExportFilter(report){
 const {basis,formId,eventId,searchUsed}=report.filters;
 return {label:'Sydney date range / basis / filters',query:`${report.filters.from} to ${report.filters.to}; ${basis}; form ${formId||'all'}; event ${eventId||'all'}; ${programmeFilterLabel(report.filters)}; candidate search ${searchUsed?'applied':'none'}; ${report.coverage.label}. This export contains the complete filtered aggregate report, not only the displayed response page. Year-over-year comparisons use matching Sydney month/day windows within the selected period, excluding 29 February from both years; a zero previous count has no percentage change. ${INSIGHTS_PROVENANCE}`};
}
export function insightsPdfMetricRows(report){
 return [{kind:'Total',period:'All selected records',count:report.submissions},
  ...(Number.isSafeInteger(report.identified)?[{kind:'Identified people',period:'Current confirmed reviewed links',count:report.identified}]:[]),
  ...report.years.map(item=>({kind:'Year',period:item.year,count:item.count})),
  ...yearOverYear(report.days,report.filters).map(item=>({kind:'Year-over-year change',period:`${item.previousYear} to ${item.year}; ${item.first} to ${item.last}; ${item.before} to ${item.after}; ${item.percent===null?'percentage unavailable':(item.percent*100).toFixed(1)+'%'}`,count:item.change})),
  ...report.months.map(item=>({kind:'Month',period:item.month,count:item.count})),
  ...report.eventRows.map(item=>({kind:'Event',period:item.title,count:item.count}))];
}

import {adjustedGregorianToIslamic,adjustedIslamicToGregorian,addHijriMonths,HIJRI_MONTHS} from '../../Centralised Calendar/src/services/hijriService.js';

export const sydneyDay=value=>value?new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):'';
export function monthKey(value,mode,overrides=[]){
 const day=sydneyDay(value);if(!day)return '';
 if(mode==='gregorian')return day.slice(0,7);
 const [year,month,date]=day.split('-').map(Number),h=adjustedGregorianToIslamic(year,month,date,overrides);
 return `${h.year}-${String(h.month).padStart(2,'0')}`;
}
export function currentMonthKey(mode,overrides=[]){return monthKey(new Date().toISOString(),mode,overrides);}
export function monthNames(mode){return mode==='hijri'?HIJRI_MONTHS.map(item=>item.name):Array.from({length:12},(_,index)=>new Intl.DateTimeFormat('en-AU',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2024,index,1))));}
export function gregorianMonthsForHijri(key,overrides=[]){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))throw Error('Choose a Hijri year and month.');
 const [year,month]=key.split('-').map(Number),next=addHijriMonths(year,month,1);
 const first=adjustedIslamicToGregorian(year,month,1,overrides),after=adjustedIslamicToGregorian(next.year,next.month,1,overrides);
 const cursor=new Date(Date.UTC(first.year,first.month-1,1)),end=new Date(Date.UTC(after.year,after.month-1,after.day-1));
 const result=[];
 while(cursor<=end){result.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth()+1).padStart(2,'0')}`);cursor.setUTCMonth(cursor.getUTCMonth()+1);}
 return result;
}

import React from 'react';
import {yearOverYear} from './insights-provenance.mjs';

export function MonthlyChart({items,onSelect,disabled=false}){
 const max=Math.max(1,...items.map(item=>item.count));
 if(!items.length)return <p>No indexed submissions in this period.</p>;
 return <section><h3>Monthly submissions bar chart</h3><p>Each bar selects that Sydney month using the other applied filters. Counts are submissions, not people or attendance.</p>
 <div role="group" aria-label="Monthly submissions bar chart" style={{display:'flex',alignItems:'end',gap:8,overflowX:'auto',minHeight:180,padding:'1rem 0'}}>
 {items.map(item=><button type="button" key={item.month} disabled={disabled} onClick={()=>onSelect(item.month)} aria-label={`${item.month}: ${item.count} submissions; filter report`} style={{minWidth:58,height:160,display:'flex',flexDirection:'column',justifyContent:'end',alignItems:'center',border:0,background:'transparent',cursor:'pointer',padding:0}}>
 <span>{item.count}</span><span aria-hidden="true" style={{width:30,height:Math.max(3,item.count/max*120),background:'#176446',display:'block'}}/><span>{item.month}</span></button>)}</div></section>;
}
export function YearlyChart({items,onSelect,disabled=false}){
 if(!items.length)return <p>No indexed submissions in this period.</p>;
 const max=Math.max(1,...items.map(item=>item.count)),width=Math.max(320,items.length*100),height=180;
 const points=items.map((item,index)=>({x:50+(items.length===1?0:index*(width-100)/(items.length-1)),y:145-item.count/max*110,...item}));
 return <section><h3>Yearly submissions line chart</h3><p>Select a point to filter the report to that Sydney year. Counts are submissions, not people or attendance.</p>
 <div style={{overflowX:'auto'}}><svg role="group" aria-label="Yearly submissions line chart" viewBox={`0 0 ${width} ${height}`} style={{minWidth:width,width:'100%',height}}>
 <line x1="30" y1="145" x2={width-25} y2="145" stroke="#667085"/><polyline fill="none" stroke="#176446" strokeWidth="3" points={points.map(p=>`${p.x},${p.y}`).join(' ')}/>
 {points.map(point=><g key={point.year}><circle cx={point.x} cy={point.y} r="8" fill="#176446" tabIndex={disabled?-1:0} role="button" aria-label={`${point.year}: ${point.count} submissions; filter report`} onClick={()=>{if(!disabled)onSelect(point.year);}} onKeyDown={event=>{if(!disabled&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onSelect(point.year);}}}/><text x={point.x} y={point.y-13} textAnchor="middle">{point.count}</text><text x={point.x} y="168" textAnchor="middle">{point.year}</text></g>)}</svg></div></section>;
}
export function ChoiceChart({options,answered}){
 const max=Math.max(1,...options.map(item=>item.count));
 return <section><h4>Choice responses bar chart</h4><p>Responses selecting each saved option; denominator {answered} valid answered responses. Multi-select responses can appear in more than one bar. The table below provides the same values; this aggregate chart does not expose response details.</p>
 <div role="img" aria-label="Choice responses bar chart" style={{display:'grid',gap:8}}>{options.map(option=><div key={option.label}><span>{option.label}: {option.count}</span><span aria-hidden="true" style={{display:'block',height:14,width:`${option.count/max*100}%`,background:'#176446'}}/></div>)}</div></section>;
}
export function FirstKnownChart({counts,onSelect,disabled=false}){
 const total=counts.identified;
 return <section><h4>First-known and returning stacked chart</h4><p>Distinct confirmed respondents in the selected period, not attendance. Select a segment to show the authorized classification list below.</p>
 {total?<div role="group" aria-label="First-known and returning stacked chart" style={{display:'flex',width:'100%',minHeight:48}}>
 {[['first-known','First-known',counts.firstKnown,'#176446'],['returning','Returning',counts.returning,'#265b9c']].filter(([, ,count])=>count>0).map(([group,label,count,color])=><button type="button" key={group} disabled={disabled} onClick={()=>onSelect(group)} aria-label={`${label}: ${count} respondents; show list`} style={{flex:`${count} 1 0`,minWidth:0,background:color,color:'white',border:'2px solid white',minHeight:48}}>{count}</button>)}</div>:<p>No confirmed respondents in this period.</p>}
 <p>First-known: {counts.firstKnown}; returning: {counts.returning}; total: {total}.</p></section>;
}
export function YearOverYearChart({items,filters,onSelect,disabled=false}){
 const comparisons=yearOverYear(items,filters),max=Math.max(1,...comparisons.flatMap(item=>[item.before,item.after]));
 return <section><h3>Year-over-year indexed submissions</h3><p>Compares matching Sydney month/day windows within the applied period, including partial years. 29 February is excluded from both years for equal calendar-day windows; indexed coverage may be incomplete. Percent change is unavailable when the previous count is zero. Selection is unavailable when the current window contains 29 February, because the filtered report cannot exclude that day.</p>
 {!comparisons.length?<p>The selected period contains no matching dates in consecutive years.</p>:<div role="group" aria-label="Year-over-year submissions bar chart" style={{display:'grid',gap:12}}>{comparisons.map(item=>{
 const year=Number(item.year),leap=year%4===0&&(year%100!==0||year%400===0),unavailable=leap&&item.first<='02-29'&&item.last>='02-29';
 return <div key={item.year}><strong>{item.previousYear} to {item.year} · {item.first} to {item.last}</strong><div><span>{item.previousYear}: {item.before}</span><span aria-hidden="true" style={{display:'block',height:12,width:`${item.before/max*100}%`,background:'#718096'}}/></div><button type="button" className="btn alt" disabled={disabled||unavailable} onClick={()=>onSelect(item.year,item.first,item.last)} aria-label={`${item.year}: ${item.after} submissions; ${unavailable?'selection unavailable':'filter report'}`}>{item.year}: {item.after}</button><span aria-hidden="true" style={{display:'block',height:12,width:`${item.after/max*100}%`,background:'#176446'}}/><span>Change: {item.change>0?'+':''}{item.change}; {item.percent===null?'percentage unavailable':`${item.percent>0?'+':''}${(item.percent*100).toFixed(1)}%`}</span></div>;
 })}</div>}</section>;
}

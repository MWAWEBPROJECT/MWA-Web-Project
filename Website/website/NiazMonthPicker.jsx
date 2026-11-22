import React from 'react';
import {monthNames} from './niaz-months.mjs';
import './niaz-month-picker.css';

export default function NiazMonthPicker({mode,value,onModeChange,onChange,allowAll=false}){
 const valid=/^\d{1,4}(?:-(?:0[1-9]|1[0-2]))?$/.test(value);
 const year=valid?value.slice(0,4):'',month=valid&&value.length===7?value.slice(5):'';
 return <div className="niaz-month-picker">
  <label>Calendar<select value={mode} onChange={event=>onModeChange(event.target.value)}><option value="gregorian">Gregorian</option><option value="hijri">Hijri</option></select></label>
  <label>Year<input type="number" inputMode="numeric" min={mode==='hijri'?1300:1900} max={mode==='hijri'?1600:2100} placeholder={allowAll?'All years':'Year'} required={!allowAll} value={year} onChange={event=>{const next=event.target.value;onChange(/^\d{1,4}$/.test(next)?next+(next.length===4&&month?`-${month}`:''):'');}}/></label>
  <label>Programme month<select value={month} required={!allowAll} disabled={year.length!==4} onChange={event=>onChange(year+(event.target.value?`-${event.target.value}`:''))}><option value="">{allowAll?'All months':'Choose month'}</option>{monthNames(mode).map((name,index)=><option key={index} value={String(index+1).padStart(2,'0')}>{name}</option>)}</select></label>
 </div>;
}

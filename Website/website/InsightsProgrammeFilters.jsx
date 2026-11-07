import React,{useEffect,useState} from 'react';

export default function InsightsProgrammeFilters({api,value,onChange,disabled=false}){
 const [categories,setCategories]=useState([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;api('/programme-options').then(data=>{if(active)setCategories(data.categories);}).catch(e=>{if(active)setError(e.message);});return ()=>{active=false;};},[]);
 function toggle(id,checked){onChange({...value,categories:checked?[...value.categories,id]:value.categories.filter(item=>item!==id)});}
 return <fieldset disabled={disabled}><legend>Programme filters</legend><p>Selected categories match any; booking type and recurring series narrow them separately. Unknown includes unclassified or stale reviews and eventless responses; inaccessible events remain excluded when filters are applied.</p>
 <label><input type="checkbox" checked={value.categories.includes('unknown')} onChange={e=>toggle('unknown',e.target.checked)}/>Unknown category</label>
 {categories.map(category=><label key={category.id}><input type="checkbox" checked={value.categories.includes(category.id)} onChange={e=>toggle(category.id,e.target.checked)}/>{category.name}</label>)}
 <label>Booking type reference<input maxLength="128" value={value.bookingType} onChange={e=>onChange({...value,bookingType:e.target.value})}/></label>
 <label>Recurring series reference<input maxLength="128" value={value.series} onChange={e=>onChange({...value,series:e.target.value})}/></label>
 {error&&<p role="alert">Could not load programme categories: {error}</p>}</fieldset>;
}
export const emptyProgrammeFilters=()=>({categories:[],bookingType:'',series:''});

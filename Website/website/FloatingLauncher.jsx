import React,{useLayoutEffect,useRef,useState} from 'react';
import {Minus} from 'lucide-react';
const key='mwa-khadim-launcher-v1';
export function readLauncherPreference(){
 try{const value=JSON.parse(localStorage.getItem(key));return {collapsed:value?.collapsed===true,x:Number.isFinite(value?.x)?Math.min(1,Math.max(0,value.x)):1,y:Number.isFinite(value?.y)?Math.min(1,Math.max(0,value.y)):1};}catch{return {collapsed:false,x:1,y:1};}
}
export default function FloatingLauncher({buttonRef,open,onOpen,preference,onPreference,children}){
 const root=useRef(null),drag=useRef(null),suppressClick=useRef(false);
 const [bounds,setBounds]=useState(null),[dragging,setDragging]=useState(false);
 useLayoutEffect(()=>{
  const measure=()=>{const box=root.current?.getBoundingClientRect();if(box)setBounds({width:Math.max(0,innerWidth-box.width-24),height:Math.max(0,innerHeight-box.height-24)});};
  measure();const observer=new ResizeObserver(measure);observer.observe(root.current);window.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 useLayoutEffect(()=>{try{localStorage.setItem(key,JSON.stringify(preference));}catch{}},[preference]);
 const place=(x,y)=>onPreference(current=>({...current,x:Math.min(1,Math.max(0,x)),y:Math.min(1,Math.max(0,y))}));
 function down(event){if(event.button!==0||!event.isPrimary||!bounds)return;suppressClick.current=false;drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,startX:preference.x,startY:preference.y,moved:false};event.currentTarget.setPointerCapture(event.pointerId);}
 function move(event){const active=drag.current;if(!active||active.id!==event.pointerId)return;const dx=event.clientX-active.x,dy=event.clientY-active.y;if(Math.hypot(dx,dy)>6)active.moved=true;if(!active.moved)return;suppressClick.current=true;setDragging(true);place(active.startX+dx/(bounds.width||1),active.startY+dy/(bounds.height||1));}
 function end(event){if(drag.current?.id!==event.pointerId)return;drag.current=null;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
 function keyboard(event){if(!event.altKey||!bounds)return;const step={ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]}[event.key];if(step){event.preventDefault();place(preference.x+step[0]/(bounds.width||1),preference.y+step[1]/(bounds.height||1));}}
 return <div ref={root} className={'mwa-ai-dock'+(preference.collapsed?' is-collapsed':'')+(dragging?' is-dragging':'')} style={bounds?{left:12+bounds.width*preference.x,top:12+bounds.height*preference.y,right:'auto',bottom:'auto'}:undefined}>
 <button ref={buttonRef} className="mwa-ai-launcher" aria-label="Ask MWA Khadim for help" aria-haspopup="dialog" aria-expanded={open} title="Open MWA Khadim. Drag to move, or use Alt + arrow keys." onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={keyboard} onClick={event=>{if(suppressClick.current&&event.detail!==0){suppressClick.current=false;return;}onOpen();}}>
 <span className="mwa-ai-avatar"><img src="/images/mwa-ai-helper.jpg" alt="" draggable="false"/></span>{!preference.collapsed&&children}</button>
 {!preference.collapsed&&<button className="mwa-ai-collapse" aria-label="Collapse MWA Khadim to icon" title="Show icon only" onClick={()=>onPreference(current=>({...current,collapsed:true}))}><Minus size={18} aria-hidden="true"/></button>}
 </div>;
}

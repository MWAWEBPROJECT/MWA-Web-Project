import React,{useLayoutEffect,useRef,useState} from 'react';
const key='mwa-khadim-launcher-v1';
const clamp=value=>Math.min(1,Math.max(0,value));
export function readLauncherPreference(){
 try{const value=JSON.parse(localStorage.getItem(key));return {collapsed:false,x:Number.isFinite(value?.x)?clamp(value.x):1,y:Number.isFinite(value?.y)?clamp(value.y):1};}catch{return {collapsed:false,x:1,y:1};}
}
export default function FloatingLauncher({buttonRef,open,onOpen,preference,onPreference,children}){
 const root=useRef(null),drag=useRef(null),suppressClick=useRef(false),holdTimer=useRef(null);
 const [bounds,setBounds]=useState(null),[dragging,setDragging]=useState(false);
 useLayoutEffect(()=>{
  const measure=()=>{const box=root.current?.getBoundingClientRect();if(box)setBounds({width:Math.max(0,innerWidth-box.width-24),height:Math.max(0,innerHeight-box.height-24)});};
  measure();const observer=new ResizeObserver(measure);observer.observe(root.current);window.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);clearTimeout(holdTimer.current);};
 },[]);
 // Always begin expanded on a new page; only the chosen position persists.
 useLayoutEffect(()=>{try{localStorage.setItem(key,JSON.stringify({x:preference.x,y:preference.y}));}catch{}},[preference.x,preference.y]);
 const place=(x,y)=>onPreference(current=>({...current,x:clamp(x),y:clamp(y)}));
 function positionIcon(x,y){onPreference(current=>({...current,collapsed:true,x:clamp((x-29-12)/Math.max(1,innerWidth-58-24)),y:clamp((y-29-12)/Math.max(1,innerHeight-58-24))}));}
 function down(event){
  if(event.button!==0||!event.isPrimary||!bounds)return;
  clearTimeout(holdTimer.current);suppressClick.current=false;
  const active={id:event.pointerId,x:event.clientX,y:event.clientY,ready:false,cancelled:false};drag.current=active;event.currentTarget.setPointerCapture(event.pointerId);
  holdTimer.current=setTimeout(()=>{if(drag.current!==active||active.cancelled)return;active.ready=true;suppressClick.current=true;setDragging(true);positionIcon(active.x,active.y);},550);
 }
 function move(event){const active=drag.current;if(!active||active.id!==event.pointerId)return;
  if(!active.ready){if(Math.hypot(event.clientX-active.x,event.clientY-active.y)>10){clearTimeout(holdTimer.current);active.cancelled=true;suppressClick.current=true;}return;}
  positionIcon(event.clientX,event.clientY);
 }
 function end(event){if(drag.current?.id!==event.pointerId)return;clearTimeout(holdTimer.current);drag.current=null;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
 function keyboard(event){if(!event.altKey||!bounds)return;const step={ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]}[event.key];if(step){event.preventDefault();place(preference.x+step[0]/(bounds.width||1),preference.y+step[1]/(bounds.height||1));}}
 function activate(event){if(suppressClick.current&&event.detail!==0){suppressClick.current=false;return;}if(preference.collapsed)onPreference(current=>({...current,collapsed:false}));else onOpen();}
 return <div ref={root} className={'mwa-ai-dock'+(preference.collapsed?' is-collapsed':'')+(dragging?' is-dragging':'')} style={bounds?{left:12+bounds.width*preference.x,top:12+bounds.height*preference.y,right:'auto',bottom:'auto'}:undefined}>
 <button ref={buttonRef} className="mwa-ai-launcher" aria-label={preference.collapsed?'Expand MWA Khadim':'Ask MWA Khadim for help'} aria-haspopup="dialog" aria-expanded={open} title="Hold to collapse and move. Tap the icon to expand, then tap again to chat. Alt + arrow keys also move the helper." onContextMenu={event=>event.preventDefault()} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={keyboard} onClick={activate}>
 <span className="mwa-ai-avatar"><img data-cms-photo="photo_khadim" src="/images/mwa-ai-helper.jpg" alt="" draggable="false"/></span>{!preference.collapsed&&children}</button>
 </div>;
}

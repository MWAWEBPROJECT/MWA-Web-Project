import React,{useEffect,useRef,useState} from 'react';
import {MessageCircle,Sparkles,ArrowUpRight,Send,X,RotateCcw} from 'lucide-react';
import './mwa-assistant.css';
const suggestions=['I want to donate for Niaz','I want to book an event','Where can I find the Will Form?','Help me change the text size','Show me the latest donations'];
export default function MwaAssistant({ask,subscribe=()=>()=>{}}){
 const [open,setOpen]=useState(false),[messages,setMessages]=useState([]),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef(null),launcher=useRef(null),field=useRef(null),log=useRef(null),generation=useRef(0),pending=useRef(false);
 function clear(){generation.current++;pending.current=false;setMessages([]);setInput('');setError('');setBusy(false);}
 useEffect(()=>subscribe(clear),[subscribe]);
 useEffect(()=>{if(open){dialog.current?.showModal();field.current?.focus();}else if(dialog.current?.open)dialog.current.close();},[open]);
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight});},[messages,busy,error]);
 function close(){setOpen(false);launcher.current?.focus();}
 async function send(text=input){
  text=text.trim();if(!text||text.length>1000||pending.current)return;
  const current=++generation.current;pending.current=true;setBusy(true);setError('');setInput('');
  const history=messages.slice(-8).map(m=>({role:m.role,text:m.text}));
  setMessages(prev=>[...prev,{role:'user',text}]);
  try{const reply=await ask({message:text,history});if(current!==generation.current)return;setMessages(prev=>[...prev,{role:'model',text:reply.answer,links:reply.links||[]}]);}
  catch(problem){if(current===generation.current){setError(problem.message||'Could not connect. Please try again.');setInput(text);setMessages(prev=>prev.slice(0,-1));}}
  finally{if(current===generation.current){pending.current=false;setBusy(false);field.current?.focus();}}
 }
 return <div className="mwa-ai"><button ref={launcher} className="mwa-ai-launcher" aria-label="Ask MWA.ai for help" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><MessageCircle size={22} aria-hidden="true"/><span>MWA.ai</span></button>
 <dialog ref={dialog} className="mwa-ai-dialog" aria-labelledby="mwa-ai-title" onCancel={event=>{event.preventDefault();close();}} onClose={()=>setOpen(false)}>
 <header className="mwa-ai-header"><span className="mwa-ai-mark"><Sparkles size={23} aria-hidden="true"/></span><div><h2 id="mwa-ai-title">MWA.ai</h2><p>Your MWA guide</p></div><button type="button" aria-label="Clear conversation" title="Clear conversation" onClick={()=>{clear();field.current?.focus();}}><RotateCcw size={18}/></button><button type="button" aria-label="Close assistant" onClick={close}><X size={21}/></button></header>
 <div ref={log} className="mwa-ai-log" role="log" aria-live="polite" aria-relevant="additions text"><div className="mwa-ai-welcome"><h3>What would you like to do?</h3><p>I can help you find the right MWA form, service or resource.</p>{!messages.length&&<div className="mwa-ai-suggestions">{suggestions.map(text=><button key={text} type="button" disabled={busy} onClick={()=>send(text)}>{text}<ArrowUpRight size={16} aria-hidden="true"/></button>)}</div>}</div>
 {messages.map((message,index)=><div key={index} className={'mwa-ai-message '+message.role}><small>{message.role==='user'?'You':'MWA.ai'}</small><p dir="auto">{message.text}</p>{message.links?.map(link=>typeof link.href==='string'&&/^\/(?!\/)/.test(link.href)&&!/[\\r\n]/.test(link.href)?<a key={link.id} href={link.href} onClick={close}>{link.title}<ArrowUpRight size={16} aria-hidden="true"/></a>:null)}</div>)}
 {busy&&<p className="mwa-ai-thinking" role="status">Finding the right place for youâ€¦</p>}{error&&<p role="alert" className="mwa-ai-error">{error} You can also <a href="/#contact" onClick={close}>contact MWA</a>.</p>}</div>
 <form className="mwa-ai-compose" onSubmit={event=>{event.preventDefault();send();}}><label htmlFor="mwa-ai-question" className="mwa-ai-sr">What would you like help with?</label><div><textarea ref={field} id="mwa-ai-question" value={input} onChange={e=>setInput(e.target.value)} placeholder="Tell me what youâ€™d like to doâ€¦" maxLength={1000} rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send();}}}/><button type="submit" disabled={busy||!input.trim()} aria-label="Send question"><Send size={19}/></button></div><p>AI guidance may be imperfect. Messages are sent to Google Cloud Gemini. Donâ€™t share private details. Chat clears when you leave this page.</p></form>
 </dialog></div>;
}

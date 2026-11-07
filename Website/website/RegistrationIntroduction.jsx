import React,{useRef} from 'react';

function displayRuns(description='',descriptionRuns){
 if(Array.isArray(descriptionRuns)&&descriptionRuns.length&&descriptionRuns.every(run=>run&&typeof run.text==='string'&&typeof run.bold==='boolean'))return descriptionRuns;
 return description?[{text:description,bold:false}]:[];
}

function readRuns(root){
 const result=[];
 function append(text,bold){
  if(!text)return;
  const previous=result.at(-1);
  if(previous&&previous.bold===bold)previous.text+=text;
  else result.push({text,bold});
 }
 function visit(node,bold=false){
  if(node.nodeType===Node.TEXT_NODE){append(node.nodeValue,bold);return;}
  if(node.nodeType!==Node.ELEMENT_NODE)return;
  const name=node.nodeName,nextBold=bold||name==='B'||name==='STRONG';
  if(name==='BR'){append('\n',bold);return;}
  const block=name==='DIV'||name==='P'||name==='LI';
  if(block&&result.length&&!result.at(-1).text.endsWith('\n'))append('\n',bold);
  const before=result.length;
  for(const child of node.childNodes)visit(child,nextBold);
  if(block&&result.length>before&&!result.at(-1).text.endsWith('\n'))append('\n',bold);
 }
 for(const child of root.childNodes)visit(child);
 while(result.length&&result.at(-1).text.endsWith('\n')){
  const last=result.at(-1);last.text=last.text.replace(/\n+$/,'');if(!last.text)result.pop();
 }
 return result;
}

export function RegistrationIntroduction({description='',descriptionRuns,className='',as='div'}){
 const Tag=as,runs=displayRuns(description,descriptionRuns);
 return <Tag className={className}>{runs.map((run,index)=>run.bold?<strong key={index}>{run.text}</strong>:<React.Fragment key={index}>{run.text}</React.Fragment>)}</Tag>;
}

export function RegistrationIntroductionEditor({description='',descriptionRuns,onChange}){
 const editor=useRef(null),initialRuns=useRef(null);
 if(initialRuns.current===null)initialRuns.current=displayRuns(description,descriptionRuns);
 function publish(){
  const runs=readRuns(editor.current);
  onChange(runs.map(run=>run.text).join(''),runs);
 }
 function bold(event){
  event.preventDefault();
  editor.current?.focus();
  document.execCommand('bold');
  publish();
 }
 function paste(event){
  event.preventDefault();
  const text=event.clipboardData?.getData('text/plain')||'';
  document.execCommand('insertText',false,text);
 }
 return <div className="registration-rich-editor">
  <div className="registration-rich-toolbar"><button type="button" className="btn alt small" onMouseDown={event=>event.preventDefault()} onClick={bold}><strong>Bold</strong></button><span>Use the toolbar to bold selected text.</span></div>
  <div ref={editor} className="registration-rich-input" contentEditable role="textbox" aria-label="Introduction" aria-multiline="true" suppressContentEditableWarning onInput={publish} onBlur={publish} onPaste={paste} onDrop={event=>event.preventDefault()}>{initialRuns.current.map((run,index)=>run.bold?<strong key={index}>{run.text}</strong>:<React.Fragment key={index}>{run.text}</React.Fragment>)}</div>
  <small>Maximum 2,000 characters.</small>
 </div>;
}

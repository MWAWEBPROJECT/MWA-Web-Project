// Adapted from CommunityConnect-WebApp src/registration/prototypeModel.mjs,
// revision 97ee4514022f331bdc1af375dddb09b2f91b4603. No event-booking authority.
export const FIELD_TYPES = [
  ['text', 'Short answer'], ['textarea', 'Long answer'], ['email', 'Email'],
  ['phone', 'Phone'], ['number', 'Number'], ['date', 'Date'],
  ['select', 'Dropdown'], ['radio', 'Multiple choice'], ['checkboxes', 'Checkboxes'],
  ['consent', 'Consent'],
];
const standard = [
  {id:'name', label:'Full name', type:'text', required:true},
  {id:'email', label:'Email', type:'email', required:true},
  {id:'phone', label:'Phone', type:'phone', required:true},
  {id:'diet', label:'Dietary requirements', type:'textarea', required:false},
  {id:'access', label:'Accessibility requirements', type:'textarea', required:false},
];
export const FORM_TEMPLATES = [
  {name:'Basic registration', ids:['name','email','phone']},
  {name:'Community meal', ids:['name','email','phone','diet','access']},
  {name:'Community feedback', fields:[
    {id:'feedback', type:'textarea', label:'Your feedback', required:true},
    {id:'email', type:'email', label:'Email (if you would like a reply)', required:false},
  ]},
];
export function templateFields(template) {
  return (template.fields || standard.filter(field=>template.ids.includes(field.id)))
    .map(field=>({...field, description:'', options:[], terms:''}));
}
export function makeField(type, id) {
  return {id,type,label:type==='consent'?'Agreement':'New question',description:'',terms:'',
    required:type==='consent',options:['select','radio','checkboxes'].includes(type)?['Option 1','Option 2']:[]};
}
export function consentLast(fields) {
  return [...fields.filter(field=>field.type!=='consent'),...fields.filter(field=>field.type==='consent')];
}
export function moveField(fields, index, direction) {
  const target=index+direction;
  if(index<0||target<0||index>=fields.length||target>=fields.length||fields[index].type==='consent'||fields[target].type==='consent')return fields;
  const next=[...fields];[next[index],next[target]]=[next[target],next[index]];return next;
}
export function validDate(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
    Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
function text(value, max, required=false) {
  if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error('Check the question labels, help text and options.');
  return value.trim();
}
export function cleanIntroductionRuns(runs) {
  if(!Array.isArray(runs)||runs.length>200)throw Error('Keep the introduction to no more than 200 text sections.');
  const result=[];let length=0;
  for(const run of runs){
    if(!run||typeof run!=='object'||Array.isArray(run)||typeof run.text!=='string'||typeof run.bold!=='boolean'||Object.keys(run).some(key=>key!=='text'&&key!=='bold'))throw Error('Check the introduction formatting.');
    length+=run.text.length;
    if(length>2000)throw Error('Keep the introduction to 2,000 characters or fewer.');
    if(!run.text)continue;
    const previous=result.at(-1);
    if(previous&&previous.bold===run.bold)previous.text+=run.text;
    else result.push({text:run.text,bold:run.bold});
  }
  const plain=result.map(run=>run.text).join(''),trimmed=plain.trim();
  if(plain!==trimmed){
    const start=plain.length-plain.trimStart().length,end=plain.trimEnd().length;
    let offset=0;
    return result.map(run=>{
      const from=Math.max(0,start-offset),to=Math.max(0,Math.min(run.text.length,end-offset));
      offset+=run.text.length;
      return {text:run.text.slice(from,to),bold:run.bold};
    }).filter(run=>run.text);
  }
  return result;
}
export function cleanIntroduction(description, runs) {
  const plain=text(description??'',2000);
  if(runs===undefined)return {description:plain,descriptionRuns:plain?[{text:plain,bold:false}]:[]};
  const descriptionRuns=cleanIntroductionRuns(runs),formatted=descriptionRuns.map(run=>run.text).join('');
  if(plain!==formatted)throw Error('The introduction text and formatting do not match.');
  return {description:formatted,descriptionRuns};
}
export function cleanFields(fields) {
  if(!Array.isArray(fields)||!fields.length||fields.length>30)throw Error('Add between 1 and 30 questions.');
  const ids=new Set();
  const result=fields.map(field=>{
    if(!field||typeof field!=='object'||typeof field.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(field.id)||['__proto__','prototype','constructor'].includes(field.id)||ids.has(field.id))throw Error('Question identifiers must be unique and valid.');
    ids.add(field.id);
    if(!FIELD_TYPES.some(([type])=>type===field.type)||typeof field.required!=='boolean')throw Error('Choose a supported question type and required setting.');
    const clean={id:field.id,type:field.type,label:text(field.label,200,true),description:text(field.description??'',500),required:field.required,options:[],terms:''};
    if(['select','radio','checkboxes'].includes(field.type)){
      if(!Array.isArray(field.options)||field.options.length<2||field.options.length>20)throw Error('Choice questions need 2 to 20 different options.');
      clean.options=field.options.map(option=>text(option,100,true));
      if(new Set(clean.options).size!==clean.options.length)throw Error('Choice options must be different.');
    }
    if(field.type==='consent'){
      clean.terms=text(field.terms,1000,true);
      if(!field.required)throw Error('Consent must be required when included.');
    }
    return clean;
  });
  return consentLast(result);
}
export function validateAnswers(fields, answers) {
  const errors={};
  if(!answers||typeof answers!=='object'||Array.isArray(answers))return {form:'Check your answers.'};
  if(Object.keys(answers).some(id=>!fields.some(field=>field.id===id)))errors.form='The questions changed. Reload this form.';
  for(const field of fields){
    const value=Object.hasOwn(answers,field.id)?answers[field.id]:undefined;
    const empty=value==null||value===false||(typeof value==='string'&&!value.trim())||(Array.isArray(value)&&!value.length);
    if(empty){if(field.required)errors[field.id]='This answer is required.';continue;}
    if(field.type==='consent'){if(value!==true)errors[field.id]='Select this checkbox to agree.';continue;}
    if(field.type==='checkboxes'){
      if(!Array.isArray(value)||value.length>field.options.length||new Set(value).size!==value.length||value.some(option=>!field.options.includes(option)))errors[field.id]='Choose only listed options.';
      continue;
    }
    if(typeof value!=='string'||value.length>2000){errors[field.id]='Use an answer of no more than 2,000 characters.';continue;}
    if(field.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))errors[field.id]='Enter a valid email address.';
    else if(field.type==='phone'&&!/^\+?[\d\s()-]{7,20}$/.test(value))errors[field.id]='Enter a valid phone number.';
    else if(field.type==='number'&&!Number.isFinite(Number(value)))errors[field.id]='Enter a number.';
    else if(field.type==='date'&&!validDate(value))errors[field.id]='Enter a valid date.';
    else if(['select','radio'].includes(field.type)&&!field.options.includes(value))errors[field.id]='Choose a listed option.';
  }
  return errors;
}

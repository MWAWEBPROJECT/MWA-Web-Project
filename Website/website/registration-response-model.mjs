export function responseAnswer(field,value){
 if(value==null||value==='')return '';
 if(field.type==='consent')return value===true?'Agreed':'Not agreed';
 return Array.isArray(value)?value.join(', '):String(value);
}
export function filterResponses(rows,{field='',query=''}={}){
 const needle=query.trim().toLocaleLowerCase('en-AU');
 if(!needle)return rows;
 return rows.filter(row=>row.fields.some(question=>(!field||question.id===field)&&responseAnswer(question,row.answers[question.id]).toLocaleLowerCase('en-AU').includes(needle)));
}
export function responseQuestions(form,rows){
 const questions=new Map();
 for(const field of [...(form?.fields||[]),...rows.flatMap(row=>row.fields)]){
  if(!questions.has(field.id))questions.set(field.id,{id:field.id,labels:new Set()});
  questions.get(field.id).labels.add(field.label);
 }
 return [...questions.values()].map(question=>({id:question.id,label:[...question.labels].join(' / ')}));
}

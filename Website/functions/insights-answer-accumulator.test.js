const test=require('node:test');
const assert=require('node:assert/strict');
const Answer=require('./insights-answer-analysis');
const Mapping=require('./insights-mapping');

const fields=[
 {id:'choice',type:'checkboxes',label:'Choice',required:false,options:['A','B']},
 {id:'time',type:'radio',label:'Time',required:false,options:['X','Y']},
 {id:'amount',type:'number',label:'Amount',required:false,options:[]}
];
const entries=[
 {fieldId:'choice',role:'',concept:'choice'},
 {fieldId:'time',role:'',concept:'time'},
 {fieldId:'amount',role:'',concept:'amount'}
];
const form='form',at='2026-03-01T00:00:00.000Z';
const source=answers=>({exists:true,data:()=>({revision:1,fields,answers,eventId:'',createdAt:at})});
const data=[
 {choice:['A','B'],time:'X',amount:'2.5'},
 {choice:['B'],time:'Y',amount:'4'},
 {choice:['PRIVATE'],time:'X',amount:'not a number'},
 {choice:[],amount:''}
];
const rows=data.map((_,i)=>({formId:form,responseId:String(i),submittedAt:at,eventId:''}));
const docs=new Map([[`_insightsState/fieldMappings/forms/${form}/revisions/1`,{data:()=>({
 status:'reviewed',schemaHash:Mapping.hashSchema(Mapping.schema(fields)),entries
})}]]);
data.forEach((value,i)=>docs.set(`registrationForms/${form}/responses/${i}`,source(value)));

test('incremental answer accumulation matches one pass without storing personal answers',()=>{
 for(const [concept,second] of [['choice',''],['choice','time'],['amount','']]){
  const all=Answer.accumulate(Answer.emptyAccumulator(),rows,docs,concept,new Map(),false,second);
  let batch=Answer.emptyAccumulator();
  for(const row of rows)batch=Answer.accumulate(JSON.parse(JSON.stringify(batch)),[row],docs,concept,new Map(),false,second);
  assert.deepEqual(batch,all);
  assert.doesNotMatch(JSON.stringify(batch),/PRIVATE|not a number/);
  const result=Answer.summarizeAccumulator(batch,concept,second);
  assert.equal(result.coverage.indexed,4);
  if(concept==='choice'&&second)assert.deepEqual(result.crossTabs[0].counts,[[1,0],[1,1]]);
  if(concept==='amount')assert.equal(result.groups[0].mean,3.25);
 }
});

test('empty answer analysis and invalid concepts keep the existing response contract',()=>{
 assert.equal(Answer.summarizeAccumulator(Answer.emptyAccumulator(),'choice').coverage.indexed,0);
 assert.throws(()=>Answer.validateConcepts('choice','choice'),error=>error.status===400);
});

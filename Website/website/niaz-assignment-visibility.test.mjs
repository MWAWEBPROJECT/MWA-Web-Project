import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleAssignments,assignedSponsorIds,visibleSponsorRows} from './niaz-assignment-visibility.mjs';

const rows=[
 {id:'old',eventId:'5-muharram',sponsorId:'sponsor-a',status:'approved'},
 {id:'new',eventId:'6-muharram',sponsorId:'sponsor-b',status:'approved'},
 {id:'pending',eventId:'6-muharram',sponsorId:'sponsor-a',status:'pending'}
];
test('selected event determines current assignments even if a sponsor has another event',()=>{
 assert.deepEqual(visibleAssignments(rows,['6-muharram'],['sponsor-a']).map(row=>row.id),['new']);
 assert.deepEqual(visibleAssignments(rows,['unassigned'],['sponsor-a']),[]);
});
test('sponsor-only selection shows that sponsor’s approved assignments',()=>{
 assert.deepEqual(visibleAssignments(rows,[],['sponsor-a']).map(row=>row.id),['old']);
 assert.deepEqual(visibleAssignments(rows,[],[]),[]);
});
test('approved sponsors for the selected event are marked and sorted first',()=>{
 const assigned=assignedSponsorIds(rows,['5-muharram']);
 assert.deepEqual([...assigned],['sponsor-a']);
 const sponsors=[{id:'sponsor-b',name:'A name'},{id:'sponsor-a',name:'Z name'}];
 assert.deepEqual(visibleSponsorRows(sponsors,{assignedIds:assigned}).map(row=>row.id),['sponsor-a','sponsor-b']);
 assert.deepEqual([...assignedSponsorIds(rows,['unassigned'])],[]);
});
test('explicitly selected sponsor stays visible and first through filtering and clearing',()=>{
 const sponsors=[{id:'a',name:'Aaliyah',active:true},{id:'b',name:'Bilal',active:true},{id:'c',name:'Cem',active:false}];
 const selectedIds=new Set(['b']),assignedIds=new Set(['c']);
 assert.deepEqual(visibleSponsorRows(sponsors,{query:'aaliyah',status:'active',selectedIds,assignedIds}).map(row=>row.id),['b','c','a']);
 assert.deepEqual(visibleSponsorRows(sponsors,{selectedIds,assignedIds}).map(row=>row.id),['b','c','a']);
 assert.deepEqual(visibleSponsorRows(sponsors,{}).map(row=>row.id),['a','b','c']);
});

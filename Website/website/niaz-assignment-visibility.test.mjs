import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleAssignments} from './niaz-assignment-visibility.mjs';

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

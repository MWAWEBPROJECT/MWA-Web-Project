import assert from 'node:assert/strict';
import {test} from 'node:test';
import {niazProgrammeDate,niazOfferUrl,parseNiazProgrammeLink} from './niazProgramme.mjs';

test('Niaz card link derives Sydney date across UTC midnight and seasonal offsets',()=>{
 assert.equal(niazProgrammeDate('2027-01-10T23:30:00Z'),'2027-01-11');
 assert.equal(niazProgrammeDate('2027-06-10T23:30:00Z'),'2027-06-11');
 assert.equal(niazProgrammeDate('2027-01-10T13:30:00Z'),'2027-01-11');
 assert.equal(niazOfferUrl('event_1-A','2027-01-10T23:30:00Z'),'/niaz/?event=event_1-A&date=2027-01-11');
 const link=new URL(niazOfferUrl('event_1-A','2027-01-10T23:30:00Z'),'https://example.org');
 assert.equal(link.searchParams.get('event'),'event_1-A');
 assert.equal(link.searchParams.get('date'),'2027-01-11');
});
test('invalid card context falls back without leaking unsupported URL values',()=>{
 for(const [id,date] of [['event1',null],['event1','invalid'],['a&event=other','2027-01-10T23:30:00Z'],['','2027-01-10T23:30:00Z']]){
  assert.equal(niazOfferUrl(id,date),'/niaz/');
 }
});
test('programme links require one valid reference and real ISO calendar date',()=>{
 assert.deepEqual(parseNiazProgrammeLink('?event=event_1-A&date=2027-01-11'),{requested:true,valid:true,eventId:'event_1-A',date:'2027-01-11'});
 assert.equal(parseNiazProgrammeLink('').requested,false);
 for(const search of ['?event=event1','?date=2027-01-11','?event=event1&date=2027-02-29','?event=event1&date=2027-02-30','?event=event1&date=invalid','?event=%3Cscript%3E&date=2027-01-11','?event=event1&event=event2&date=2027-01-11','?event=event1&date=2027-01-11&date=2027-01-12']){
  const parsed=parseNiazProgrammeLink(search);
  assert.equal(parsed.requested,true);assert.equal(parsed.valid,false);assert.equal(parsed.eventId,null);assert.equal(parsed.date,null);
 }
});

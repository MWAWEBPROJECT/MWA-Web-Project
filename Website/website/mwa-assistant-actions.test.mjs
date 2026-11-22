import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAction} from './mwa-assistant-actions.mjs';
import catalogue from '../functions/mwa-ai-catalog.json' with {type:'json'};

test('Khadim offers controlled panels for every live public submission path',()=>{
 const expected={
  book:'booking',niaz:'niaz',forms:'registration',contact:'contact',
  membership:'contact',school:'contact',tutoring:'contact',volunteer:'contact',
  counselling:'contact',support:'contact',cemetery:'contact',aalim:'contact',
  donate:'donation','donate-niaz':'donation','donate-khums':'donation',
  'donate-fitra':'donation','recurring-donation':'donation',appearance:'appearance'
 };
 for(const [id,kind] of Object.entries(expected)){
  assert.ok(catalogue.some(entry=>entry.id===id&&entry.public===true),id+' must be public');
  assert.equal(publicAction(id)?.kind,kind,id);
 }
 assert.equal(publicAction('admin'),null);
 assert.equal(publicAction('donations-admin'),null);
 assert.equal(publicAction('gallery'),null);
 assert.equal(publicAction('prayer'),null);
 assert.equal(publicAction('recurring-donation').mode,'recurring_only');
 assert.equal(publicAction('donate-niaz').fund,'Niaz Contribution');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {adjustedIslamicToGregorian,addHijriMonths} from '../../Centralised Calendar/src/services/hijriService.js';
import {gregorianMonthsForHijri,monthKey} from './niaz-months.mjs';

const iso=day=>new Date(Date.UTC(day.year,day.month-1,day.day)).toISOString();
test('a Hijri dashboard month loads every overlapping Gregorian month and excludes neighbours',()=>{
 const key='1448-05',first=adjustedIslamicToGregorian(1448,5,1),next=addHijriMonths(1448,5,1),after=adjustedIslamicToGregorian(next.year,next.month,1);
 const months=gregorianMonthsForHijri(key),last=new Date(Date.parse(iso(after))-86400000).toISOString();
 assert.equal(monthKey(iso(first),'hijri'),key);
 assert.equal(monthKey(last,'hijri'),key);
 assert.notEqual(monthKey(new Date(Date.parse(iso(first))-86400000).toISOString(),'hijri'),key);
 assert.equal(monthKey(iso(after),'hijri'),`${next.year}-${String(next.month).padStart(2,'0')}`);
 assert.ok(months.includes(monthKey(iso(first),'gregorian')));
 assert.ok(months.includes(monthKey(last,'gregorian')));
 assert.ok(months.length>=1&&months.length<=3);
});

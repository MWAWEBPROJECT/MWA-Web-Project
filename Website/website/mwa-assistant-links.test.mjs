import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeAssistantHref} from './mwa-assistant-links.mjs';
test('sign-in, resources and donation links remain actionable',()=>{for(const href of ['/admin-login?returnTo=%2Fadmin-login%3Fmodule%3Dniaz','/?donationFund=khums#donate','/#resources'])assert(safeAssistantHref(href),href);});
test('reject external links, backslashes and line breaks',()=>{for(const href of ['//evil.example','https://evil.example','/\\evil','/bad\rpath','/bad\npath',null])assert(!safeAssistantHref(href));});

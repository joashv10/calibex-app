import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextLinkText, isDayContext, CONTEXT_OPTIONS } from '../lib/dayContext.ts';

test('unset and normal show the question', () => {
  assert.deepEqual(contextLinkText('normal'), { lead: '', action: 'Travel, sick or rest day?' });
  assert.equal(contextLinkText('bogus').lead, '');
});

test('set contexts show "<Label> day · change"', () => {
  assert.deepEqual(contextLinkText('travel'), { lead: 'Travel day', action: 'change' });
  assert.equal(contextLinkText('sick').lead, 'Sick day');
  assert.equal(contextLinkText('rest').lead, 'Rest day');
});

test('options match the DB check constraint', () => {
  for (const o of CONTEXT_OPTIONS) assert.ok(isDayContext(o.id));
  assert.equal(isDayContext('holiday'), false);
});

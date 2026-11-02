import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtSteps, fmtStepsDelta } from '../lib/steps.ts';

test('fmtSteps: as-is under 1000, one-decimal k from 1000', () => {
  assert.equal(fmtSteps(0), '0');
  assert.equal(fmtSteps(999), '999');
  assert.equal(fmtSteps(1000), '1k');
  assert.equal(fmtSteps(14832), '14.8k');
  assert.equal(fmtSteps(9049), '9k');
  assert.equal(fmtSteps(9050), '9.1k');
  assert.equal(fmtSteps(999.6), '1k');
});

test('fmtStepsDelta: signed, compact', () => {
  assert.equal(fmtStepsDelta(1234), '+1.2k');
  assert.equal(fmtStepsDelta(-300), '−300');
  assert.equal(fmtStepsDelta(-2500), '−2.5k');
  assert.equal(fmtStepsDelta(0.4), '±0');
});

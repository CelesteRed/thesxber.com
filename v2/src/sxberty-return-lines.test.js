import test from 'node:test';
import assert from 'node:assert/strict';
import { RETURN_LINES, chooseReturnLine } from './sxberty-return-lines.js';

test('return dialogue has exactly four unique, short cause-specific Sxberty lines', () => {
  assert.deepEqual(Object.keys(RETURN_LINES), ['offscreen', 'lava', 'monster']);
  assert.ok(Object.isFrozen(RETURN_LINES));
  const causeWords = {
    offscreen: /offscreen|screen edge|out of view/i,
    lava: /lava/i,
    monster: /monster/i,
  };
  const allLines = [];
  for (const [reason, lines] of Object.entries(RETURN_LINES)) {
    assert.ok(Object.isFrozen(lines));
    assert.equal(lines.length, 4);
    assert.equal(new Set(lines).size, 4);
    for (const line of lines) {
      assert.equal(typeof line, 'string');
      assert.match(line, /\bSxberty\b/);
      assert.match(line, causeWords[reason]);
      assert.doesNotMatch(line, /verity|\b(?:fuck|shit|damn|hell|ass)\b/i);
      assert.match(line, /^[A-Za-z .,!?]+$/);
      assert.ok(line.length <= 80);
      allLines.push(line);
    }
  }
  assert.equal(new Set(allLines).size, 12);
});

test('uniform bins reach every line in each pool', () => {
  for (const [reason, lines] of Object.entries(RETURN_LINES)) {
    for (let index = 0; index < lines.length; index += 1) {
      assert.equal(chooseReturnLine(reason, { random: () => (index + 0.5) / lines.length }), lines[index]);
    }
  }
});

test('each exact previous line is excluded and remaining lines have equal bins', () => {
  for (const [reason, lines] of Object.entries(RETURN_LINES)) {
    for (const previous of lines) {
      const available = lines.filter((line) => line !== previous);
      for (let index = 0; index < available.length; index += 1) {
        const chosen = chooseReturnLine(reason, {
          previous,
          random: () => (index + 0.5) / available.length,
        });
        assert.equal(chosen, available[index]);
        assert.notEqual(chosen, previous);
      }
      assert.notEqual(chooseReturnLine(reason, { previous, random: () => 1 }), previous);
    }
  }
});

test('previous from another cause or a nonexact string does not shrink the pool', () => {
  for (const previous of [RETURN_LINES.lava[0], `${RETURN_LINES.offscreen[0]} `, null]) {
    assert.equal(chooseReturnLine('offscreen', { previous, random: () => 0.3 }), RETURN_LINES.offscreen[1]);
  }
});

test('random boundaries and finite out-of-range values clamp safely', () => {
  const lines = RETURN_LINES.lava;
  for (const value of [-100, -Number.MIN_VALUE, 0]) {
    assert.equal(chooseReturnLine('lava', { random: () => value }), lines[0]);
  }
  for (const value of [1 - Number.EPSILON, 1, 100]) {
    assert.equal(chooseReturnLine('lava', { random: () => value }), lines[3]);
  }
});

test('invalid or throwing random sources fall back safely without repeating', () => {
  const lines = RETURN_LINES.monster;
  const sources = [
    ...[NaN, Infinity, -Infinity, undefined, null, '0.5', {}, true].map((value) => () => value),
    null,
    0.5,
    {},
    () => { throw new Error('Unavailable random source'); },
  ];
  for (const random of sources) {
    assert.equal(chooseReturnLine('monster', { random }), lines[0]);
    assert.equal(chooseReturnLine('monster', { random, previous: lines[0] }), lines[1]);
  }
  assert.ok(lines.includes(chooseReturnLine('monster')));
  assert.ok(lines.includes(chooseReturnLine('monster', { random: undefined })));
});

test('unknown reasons return null without invoking random', () => {
  for (const reason of ['unknown', '', 'toString', '__proto__', 'constructor', null, undefined]) {
    assert.equal(chooseReturnLine(reason, {
      random: () => { assert.fail('Unknown reasons must not sample randomness'); },
    }), null);
  }
});

'use strict';

const YLLangs = require('../languages.js');

describe('language table', () => {
  test('ships well over 100 target languages (David: 100+)', () => {
    expect(YLLangs.ALL.length).toBeGreaterThanOrEqual(150);
    expect(YLLangs.count).toBe(YLLangs.ALL.length);
  });

  test('every row has a code and both display names', () => {
    for (const row of YLLangs.ALL) {
      expect(row).toHaveLength(3);
      for (const cell of row) expect(typeof cell === 'string' && cell.length > 0).toBe(true);
    }
  });

  test('codes are unique', () => {
    const codes = YLLangs.ALL.map(r => r[0]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('no row was left with the raw code as its display name', () => {
    const unnamed = YLLangs.ALL.filter(r => r[0] === r[1]);
    expect(unnamed).toEqual([]);
  });

  test('every common language exists in the full table', () => {
    const codes = new Set(YLLangs.ALL.map(r => r[0]));
    for (const c of YLLangs.COMMON) expect(codes.has(c)).toBe(true);
  });

  test('NAME lookup is populated for every code', () => {
    for (const [code] of YLLangs.ALL) expect(YLLangs.NAME[code]).toBeTruthy();
  });
});

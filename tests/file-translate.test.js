'use strict';

const YLFile = require('../file-translate.js');

// Fake engine: uppercases, so it is obvious which segments were sent for
// translation and which were preserved verbatim.
const upper = async (t) => t.toUpperCase();

describe('extOf', () => {
  test('reads the extension case-insensitively', () => {
    expect(YLFile.extOf('movie.SRT')).toBe('srt');
    expect(YLFile.extOf('notes.md')).toBe('md');
    expect(YLFile.extOf('noext')).toBe('');
  });
});

describe('srt', () => {
  const src = ['1', '00:00:01,000 --> 00:00:04,000', 'Hello there', '', '2',
    '00:00:05,000 --> 00:00:07,500', 'General Kenobi'].join('\n');

  test('keeps indices and timings, translates only the caption lines', async () => {
    const out = await YLFile.translateFile({ format: 'srt', text: src, translateFn: upper });
    expect(out).toContain('00:00:01,000 --> 00:00:04,000');
    expect(out).toContain('HELLO THERE');
    expect(out.split('\n')[0]).toBe('1');
    expect(out).toContain('GENERAL KENOBI');
  });
});

describe('ass', () => {
  const src = [
    '[Script Info]',
    'Title: Example',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\i1}Hello, world{\\i0}',
  ].join('\n');

  test('translates only the dialogue text and preserves override tags', async () => {
    const out = await YLFile.translateFile({ format: 'ass', text: src, translateFn: upper });
    expect(out).toContain('[Script Info]');
    expect(out).toContain('Title: Example');
    expect(out).toContain('Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,');
    expect(out).toContain('{\\i1}');
    expect(out).toContain('{\\i0}');
    expect(out).toContain('HELLO, WORLD');
  });
});

describe('html', () => {
  const src = '<div class="a">Hello</div><script>var x = "keep me";</script><p>World</p>';

  test('translates text nodes but never tags or script bodies', async () => {
    const out = await YLFile.translateFile({ format: 'html', text: src, translateFn: upper });
    expect(out).toContain('<div class="a">');
    expect(out).toContain('HELLO');
    expect(out).toContain('var x = "keep me";');
    expect(out).toContain('WORLD');
    expect(out).not.toContain('KEEP ME');
  });
});

describe('md', () => {
  const src = [
    '# Title',
    '',
    'Some text with `inline code` and a [link](https://example.com).',
    '',
    '```js',
    'const untouched = 1;',
    '```',
  ].join('\n');

  test('protects code fences, inline code and link targets', async () => {
    const out = await YLFile.translateFile({ format: 'md', text: src, translateFn: upper });
    expect(out).toContain('const untouched = 1;');
    expect(out).toContain('`inline code`');
    expect(out).toContain('](https://example.com)');
    expect(out).toContain('SOME TEXT WITH');
    expect(out).toContain('# TITLE');
  });
});

describe('txt', () => {
  test('translates non-empty lines and keeps blank ones', async () => {
    const out = await YLFile.translateFile({ format: 'txt', text: 'one\n\ntwo', translateFn: upper });
    expect(out).toBe('ONE\n\nTWO');
  });
});

describe('failure handling', () => {
  test('a failing segment keeps its original text instead of failing the file', async () => {
    const flaky = async (t) => { if (t.includes('boom')) throw new Error('engine down'); return t.toUpperCase(); };
    const out = await YLFile.translateFile({ format: 'txt', text: 'fine\nboom here\nalso fine', translateFn: flaky });
    expect(out).toBe('FINE\nboom here\nALSO FINE');
  });
});

describe('keepEdgeSpace', () => {
  test('restores leading and trailing whitespace the engine trimmed', () => {
    expect(YLFile.keepEdgeSpace('  hi ', 'salut')).toBe('  salut ');
  });
});

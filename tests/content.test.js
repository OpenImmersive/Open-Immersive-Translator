/**
 * @jest-environment jsdom
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fns;

beforeAll(() => {
  // jsdom doesn't compute layout; fake offsetParent so shouldTranslate works
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return document.body; }
  });

  // Mock browser extension API
  global.browser = {
    storage: {
      local: {
        get: () => Promise.resolve({ targetLang: 'zh-CN', engine: 'google' })
      }
    },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: () => Promise.resolve({ success: true, translation: '测试翻译' })
    }
  };

  // Signal test mode before the IIFE runs
  global.__yllTestMode = true;

  // Load and evaluate content.js in this jsdom context
  const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  // eslint-disable-next-line no-eval
  eval(src);

  fns = global.__yllInternals;
});

afterEach(() => {
  // Clean up any injected translation elements between tests
  document.querySelectorAll('[data-yll-inject]').forEach(el => el.remove());
  document.querySelectorAll('[data-yll-done]').forEach(el => { delete el.dataset.yllDone; });
});

// ─── isAlreadyTargetLang ─────────────────────────────────────────────────────

describe('isAlreadyTargetLang', () => {
  test('always returns false for non-CJK target (en)', () => {
    expect(fns.isAlreadyTargetLang('Hello World', 'en')).toBe(false);
  });

  test('always returns false for non-CJK target even with CJK input', () => {
    expect(fns.isAlreadyTargetLang('你好世界', 'fr')).toBe(false);
  });

  test('returns true for pure CJK text with zh-CN target', () => {
    expect(fns.isAlreadyTargetLang('你好世界欢迎使用语灵灵', 'zh-CN')).toBe(true);
  });

  test('returns false for mostly-Latin text with zh-CN target', () => {
    expect(fns.isAlreadyTargetLang('Hello World from Shanghai', 'zh-CN')).toBe(false);
  });

  test('returns true when CJK ratio ~50% (above 35% threshold)', () => {
    // "你好ab" → 2 CJK / 4 non-space chars = 50% > 35%
    expect(fns.isAlreadyTargetLang('你好ab', 'zh-CN')).toBe(true);
  });

  test('returns false when CJK ratio ~17% (below 35% threshold)', () => {
    // "你abcde" → 1 CJK / 6 non-space = ~17% < 35%
    expect(fns.isAlreadyTargetLang('你abcde', 'zh-CN')).toBe(false);
  });

  test('handles exactly 35% boundary (returns false at exactly 35%)', () => {
    // 7 CJK + 13 Latin = 20 chars; 7/20 = 35% → ratio > 0.35 is false
    const text = '你好世界七八九' + 'a'.repeat(13);
    expect(fns.isAlreadyTargetLang(text, 'zh-CN')).toBe(false);
  });

  test('returns true for Japanese hiragana with ja target', () => {
    expect(fns.isAlreadyTargetLang('こんにちは世界', 'ja')).toBe(true);
  });

  test('returns true for Korean with ko target', () => {
    expect(fns.isAlreadyTargetLang('안녕하세요 반갑습니다', 'ko')).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(fns.isAlreadyTargetLang('', 'zh-CN')).toBe(false);
  });
});

// ─── extractText ─────────────────────────────────────────────────────────────

describe('extractText', () => {
  test('returns plain textContent', () => {
    const p = document.createElement('p');
    p.textContent = 'Hello World';
    expect(fns.extractText(p)).toBe('Hello World');
  });

  test('skips child elements marked data-yll-inject', () => {
    const p = document.createElement('p');
    p.textContent = 'Original text';
    const injected = document.createElement('div');
    injected.dataset.yllInject = '1';
    injected.textContent = ' [Translation]';
    p.appendChild(injected);
    expect(fns.extractText(p)).toBe('Original text');
  });

  test('includes text from non-injected child elements', () => {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('Hello '));
    const span = document.createElement('span');
    span.textContent = 'World';
    p.appendChild(span);
    expect(fns.extractText(p)).toBe('Hello World');
  });

  test('returns empty string for element with no text', () => {
    const div = document.createElement('div');
    expect(fns.extractText(div)).toBe('');
  });

  test('concatenates multiple text nodes', () => {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('foo'));
    p.appendChild(document.createTextNode('bar'));
    expect(fns.extractText(p)).toBe('foobar');
  });
});

// ─── shouldTranslate ─────────────────────────────────────────────────────────

describe('shouldTranslate', () => {
  test('returns false if data-yll-done is set', () => {
    const el = document.createElement('p');
    el.dataset.yllDone = '1';
    document.body.appendChild(el);
    expect(fns.shouldTranslate(el)).toBe(false);
    el.remove();
  });

  test('returns false if data-yll-ui is set on element', () => {
    const el = document.createElement('div');
    el.dataset.yllUi = 'true';
    document.body.appendChild(el);
    expect(fns.shouldTranslate(el)).toBe(false);
    el.remove();
  });

  test('returns false for element inside [data-yll-ui] ancestor', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-yll-ui', 'true');
    const inner = document.createElement('p');
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    expect(fns.shouldTranslate(inner)).toBe(false);
    wrapper.remove();
  });

  test('returns false for SCRIPT tag', () => {
    const el = document.createElement('script');
    document.body.appendChild(el);
    expect(fns.shouldTranslate(el)).toBe(false);
    el.remove();
  });

  test('returns false for STYLE tag', () => {
    const el = document.createElement('style');
    document.body.appendChild(el);
    expect(fns.shouldTranslate(el)).toBe(false);
    el.remove();
  });

  test('returns false for CODE tag', () => {
    const el = document.createElement('code');
    document.body.appendChild(el);
    expect(fns.shouldTranslate(el)).toBe(false);
    el.remove();
  });

  test('returns false for element inside <nav>', () => {
    const nav = document.createElement('nav');
    const p = document.createElement('p');
    p.textContent = 'Navigation item';
    nav.appendChild(p);
    document.body.appendChild(nav);
    expect(fns.shouldTranslate(p)).toBe(false);
    nav.remove();
  });

  test('returns false for element inside <header>', () => {
    const header = document.createElement('header');
    const p = document.createElement('p');
    header.appendChild(p);
    document.body.appendChild(header);
    expect(fns.shouldTranslate(p)).toBe(false);
    header.remove();
  });

  test('returns false for element inside <footer>', () => {
    const footer = document.createElement('footer');
    const p = document.createElement('p');
    footer.appendChild(p);
    document.body.appendChild(footer);
    expect(fns.shouldTranslate(p)).toBe(false);
    footer.remove();
  });

  test('returns false for element containing <code>', () => {
    const p = document.createElement('p');
    const code = document.createElement('code');
    code.textContent = 'const x = 1;';
    p.appendChild(code);
    document.body.appendChild(p);
    expect(fns.shouldTranslate(p)).toBe(false);
    p.remove();
  });

  test('returns true for regular paragraph in body', () => {
    const p = document.createElement('p');
    p.textContent = 'This is a regular paragraph.';
    document.body.appendChild(p);
    expect(fns.shouldTranslate(p)).toBe(true);
    p.remove();
  });

  test('returns true for h1 in body', () => {
    const h1 = document.createElement('h1');
    h1.textContent = 'Article title';
    document.body.appendChild(h1);
    expect(fns.shouldTranslate(h1)).toBe(true);
    h1.remove();
  });
});

// ─── escHtml ─────────────────────────────────────────────────────────────────

describe('escHtml', () => {
  test('escapes <', () => {
    expect(fns.escHtml('<script>')).toContain('&lt;');
  });

  test('escapes >', () => {
    expect(fns.escHtml('<b>text</b>')).toContain('&gt;');
  });

  test('escapes &', () => {
    expect(fns.escHtml('foo & bar')).toBe('foo &amp; bar');
  });

  test('passes through plain text unchanged', () => {
    expect(fns.escHtml('Hello World 你好')).toBe('Hello World 你好');
  });

  test('passes through double quotes (innerHTML does not encode them)', () => {
    expect(fns.escHtml('"quoted"')).toBe('"quoted"');
  });
});

// ─── injectTranslation ───────────────────────────────────────────────────────

describe('injectTranslation', () => {
  test('inserts a .yll-tr element immediately after the target', () => {
    const p = document.createElement('p');
    p.textContent = 'Original';
    document.body.appendChild(p);

    fns.injectTranslation(p, '翻译内容');

    const next = p.nextElementSibling;
    expect(next).not.toBeNull();
    expect(next.className).toBe('yll-tr');
    expect(next.textContent).toBe('翻译内容');
    p.remove();
    next && next.remove();
  });

  test('sets data-yll-done on the source element', () => {
    const p = document.createElement('p');
    p.textContent = 'Test';
    document.body.appendChild(p);

    fns.injectTranslation(p, '翻译');
    expect(p.dataset.yllDone).toBe('1');
    p.remove();
  });

  test('sets data-yll-inject on injected element', () => {
    const p = document.createElement('p');
    p.textContent = 'Test';
    document.body.appendChild(p);

    fns.injectTranslation(p, '翻译');
    const injected = p.nextElementSibling;
    expect(injected.dataset.yllInject).toBe('1');
    p.remove();
  });
});

// ─── removeTranslations ──────────────────────────────────────────────────────

describe('removeTranslations', () => {
  test('removes all [data-yll-inject] elements', () => {
    const p = document.createElement('p');
    p.textContent = 'Original';
    document.body.appendChild(p);
    fns.injectTranslation(p, '翻译');

    expect(document.querySelectorAll('[data-yll-inject]').length).toBeGreaterThan(0);
    fns.removeTranslations();
    expect(document.querySelectorAll('[data-yll-inject]').length).toBe(0);
    p.remove();
  });

  test('clears data-yll-done from source elements', () => {
    const p = document.createElement('p');
    p.textContent = 'Original';
    document.body.appendChild(p);
    fns.injectTranslation(p, '翻译');

    fns.removeTranslations();
    expect(p.dataset.yllDone).toBeUndefined();
    p.remove();
  });

  test('removes multiple injected translations', () => {
    const paragraphs = ['First paragraph text', 'Second paragraph text', 'Third paragraph text'];
    const els = paragraphs.map(text => {
      const p = document.createElement('p');
      p.textContent = text;
      document.body.appendChild(p);
      fns.injectTranslation(p, '翻译' + text);
      return p;
    });

    fns.removeTranslations();
    expect(document.querySelectorAll('[data-yll-inject]').length).toBe(0);
    els.forEach(el => el.remove());
  });
});

// ─── collectBlocks ───────────────────────────────────────────────────────────

describe('collectBlocks', () => {
  test('collects paragraph elements with sufficient text', () => {
    const main = document.createElement('main');
    const p1 = document.createElement('p');
    p1.textContent = 'This paragraph has enough text to be collected by the function.';
    const p2 = document.createElement('p');
    p2.textContent = 'Another paragraph with sufficient content.';
    main.appendChild(p1);
    main.appendChild(p2);
    document.body.appendChild(main);

    const blocks = fns.collectBlocks();
    expect(blocks).toContain(p1);
    expect(blocks).toContain(p2);
    main.remove();
  });

  test('skips paragraphs with fewer than 15 characters', () => {
    const p = document.createElement('p');
    p.textContent = 'Short text';  // < 15 chars
    document.body.appendChild(p);

    const blocks = fns.collectBlocks();
    expect(blocks).not.toContain(p);
    p.remove();
  });

  test('skips elements inside nav', () => {
    const nav = document.createElement('nav');
    const p = document.createElement('p');
    p.textContent = 'Navigation text that is long enough to pass the length check';
    nav.appendChild(p);
    document.body.appendChild(nav);

    const blocks = fns.collectBlocks();
    expect(blocks).not.toContain(p);
    nav.remove();
  });

  test('does not return duplicates when selector matches ancestor and descendant', () => {
    // "article p" and "p" both match the same element — WeakSet should deduplicate
    const article = document.createElement('article');
    const p = document.createElement('p');
    p.textContent = 'This paragraph is inside an article and should appear only once.';
    article.appendChild(p);
    document.body.appendChild(article);

    const blocks = fns.collectBlocks();
    const count = blocks.filter(el => el === p).length;
    expect(count).toBe(1);
    article.remove();
  });

  test('collects heading elements', () => {
    const h2 = document.createElement('h2');
    h2.textContent = 'Section heading that is long enough';
    document.body.appendChild(h2);

    const blocks = fns.collectBlocks();
    expect(blocks).toContain(h2);
    h2.remove();
  });

  test('skips already-translated elements', () => {
    const p = document.createElement('p');
    p.textContent = 'This paragraph was already translated and should be skipped.';
    p.dataset.yllDone = '1';
    document.body.appendChild(p);

    const blocks = fns.collectBlocks();
    expect(blocks).not.toContain(p);
    p.remove();
  });
});

// ─── 悬停翻译 hover translate ────────────────────────────────────────────────

describe('hover translate', () => {
  test('hoverKeyHeld 读对应修饰键（默认 Alt）', () => {
    expect(fns.hoverKeyHeld({ altKey: true })).toBe(true);
    expect(fns.hoverKeyHeld({ altKey: false })).toBe(false);
    expect(fns.hoverKeyHeld({ ctrlKey: true })).toBe(false); // 默认键是 Alt
  });

  test('setHoverKey off 时任何键都不触发', () => {
    fns.setHoverKey('off');
    expect(fns.hoverKeyHeld({ altKey: true })).toBe(false);
    fns.setHoverKey('Alt'); // 复位，避免污染其他用例
  });

  test('findHoverBlock 从命中的子节点向上找到可翻译段落', () => {
    document.body.innerHTML = '<article><p id="para">This is a long English paragraph worth translating.<span id="child">inline</span></p></article>';
    const child = document.getElementById('child');
    const block = fns.findHoverBlock(child);
    expect(block).not.toBeNull();
    expect(block.id).toBe('para');
  });

  test('findHoverBlock 跳过已是中文的段落', () => {
    document.body.innerHTML = '<p id="zh">这是一段已经是中文的内容不需要翻译呀呀呀</p>';
    expect(fns.findHoverBlock(document.getElementById('zh'))).toBeNull();
  });

  test('findHoverBlock 对非文本块返回 null', () => {
    document.body.innerHTML = '<div id="wrap"><nav><p>Skip me</p></nav></div>';
    // nav 内的段落被 shouldTranslate 排除
    expect(fns.findHoverBlock(document.querySelector('nav p'))).toBeNull();
  });
});

// ─── M1: style-matched injection + leaf-block fallback ───────────────────────

describe('injectTranslation M1 behaviors', () => {
  test('headings get an inline appended span, not a sibling block', () => {
    const h = document.createElement('h2');
    h.textContent = 'Machine translation systems overview';
    document.body.appendChild(h);
    fns.injectTranslation(h, '机器翻译系统概览');
    const span = h.querySelector('span.yll-tr.yll-tr-inline');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe(' 机器翻译系统概览');
    expect(h.nextElementSibling).toBeNull();
    h.remove();
  });

  test('paragraph translation still lands as a following block', () => {
    const p = document.createElement('p');
    p.textContent = 'A paragraph that is long enough to translate.';
    document.body.appendChild(p);
    fns.injectTranslation(p, '一个足够长的段落。');
    const next = p.nextElementSibling;
    expect(next.classList.contains('yll-tr')).toBe(true);
    expect(next.classList.contains('yll-tr-inline')).toBe(false);
    p.remove();
  });
});

describe('collectBlocks leaf fallback', () => {
  test('picks up bare-div copy on non-semantic pages', () => {
    document.body.innerHTML = '';
    const d = document.createElement('div');
    d.textContent = 'This page keeps its copy in plain divs with no semantic tags at all.';
    document.body.appendChild(d);
    const blocks = fns.collectBlocks();
    expect(blocks).toContain(d);
    document.body.innerHTML = '';
  });

  test('fallback skips containers that hold block-level children', () => {
    document.body.innerHTML = '';
    const wrap = document.createElement('div');
    const inner = document.createElement('p');
    inner.textContent = 'Inner paragraph text that is comfortably long enough.';
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    const blocks = fns.collectBlocks();
    expect(blocks).toContain(inner);
    expect(blocks).not.toContain(wrap);
    document.body.innerHTML = '';
  });
});

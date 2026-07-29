'use strict';

// 集成测试：sensitiveMask 开启时，translate() 出站请求已打码、返回后还原。
// 与 background.test.js 相同的 vm 加载法，额外把真实的 YLSensitive 注入上下文
// （模拟 Firefox 事件页 / importScripts 已加载的状态）。

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const YLSensitive = require('../sensitive-mask.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function loadBg({ fetchImpl, storageData = {} } = {}) {
  const ctx = vm.createContext({
    YLSensitive,
    browser: {
      storage: {
        local: {
          get(keys) {
            const ks = typeof keys === 'string'
              ? [keys]
              : Array.isArray(keys) ? keys : Object.keys(keys);
            const result = {};
            ks.forEach(k => { if (k in storageData) result[k] = storageData[k]; });
            return Promise.resolve(result);
          }
        }
      },
      runtime: { onMessage: { addListener: () => {} } },
      tabs: { query: () => Promise.resolve([{ id: 1 }]), sendMessage: () => Promise.resolve() },
      commands: { onCommand: { addListener: () => {} } }
    },
    fetch: fetchImpl,
    URL: global.URL,
    Promise: global.Promise,
    console: global.console,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout
  });
  vm.runInContext(SRC, ctx);
  return ctx;
}

// 模拟 gtx：记录收到的 q，并原样把 q 作为"译文"返回（占位符穿透）
function gtxEcho(seen) {
  return (url) => {
    const q = new URL(url).searchParams.get('q');
    seen.push(q);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve([[[q, q]], null, 'en']),
      text: () => Promise.resolve('')
    });
  };
}

describe('translate + sensitiveMask', () => {
  test('开启时：发出的 q 不含敏感原文，返回后还原', async () => {
    const seen = [];
    const ctx = loadBg({ fetchImpl: gtxEcho(seen), storageData: { sensitiveMask: true } });
    const input = '请联系 admin@example-corp.com 或致电 13812345678';
    const out = await ctx.translate({ text: input, engine: 'google', targetLang: 'zh-CN' });

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain('admin@example-corp.com');
    expect(seen[0]).not.toContain('13812345678');
    expect(seen[0]).toContain('__PII_EMAIL_1__');
    expect(seen[0]).toContain('__PII_PHONE_1__');
    expect(out).toBe(input);
  });

  test('关闭时（默认）：原文直接发出', async () => {
    const seen = [];
    const ctx = loadBg({ fetchImpl: gtxEcho(seen), storageData: {} });
    const input = '请联系 admin@example-corp.com';
    const out = await ctx.translate({ text: input, engine: 'google', targetLang: 'zh-CN' });

    expect(seen[0]).toContain('admin@example-corp.com');
    expect(out).toBe(input);
  });

  test('开启但无敏感内容：行为与关闭一致', async () => {
    const seen = [];
    const ctx = loadBg({ fetchImpl: gtxEcho(seen), storageData: { sensitiveMask: true } });
    const out = await ctx.translate({ text: 'plain text only', engine: 'google', targetLang: 'zh-CN' });
    expect(seen[0]).toBe('plain text only');
    expect(out).toBe('plain text only');
  });

  test('引擎改写占位符大小写仍能还原', async () => {
    const fetchImpl = (url) => {
      const q = new URL(url).searchParams.get('q');
      const mangled = q.toLowerCase(); // 模拟引擎把占位符变小写
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve([[[mangled, q]], null, 'en']),
        text: () => Promise.resolve('')
      });
    };
    const ctx = loadBg({ fetchImpl, storageData: { sensitiveMask: true } });
    const out = await ctx.translate({ text: 'Email ME at Admin@Example-Corp.com', engine: 'google', targetLang: 'zh-CN' });
    expect(out).toContain('Admin@Example-Corp.com'); // 原值大小写不受引擎影响
  });
});

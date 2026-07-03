'use strict';

const { maskSensitive, restoreSensitive } = require('../sensitive-mask.js');

// 打码后立即还原应无损
function roundTrip(text) {
  const { masked, entities } = maskSensitive(text);
  return { masked, entities, restored: restoreSensitive(masked, entities) };
}

describe('maskSensitive — 检测', () => {
  test('邮箱', () => {
    const r = roundTrip('联系 tester.cn+alias@example.com 获取详情');
    expect(r.masked).toBe('联系 __PII_EMAIL_1__ 获取详情');
    expect(r.entities).toEqual([{ type: 'EMAIL', serial: 1, value: 'tester.cn+alias@example.com' }]);
    expect(r.restored).toBe('联系 tester.cn+alias@example.com 获取详情');
  });

  test('中国大陆手机号（11位连续）', () => {
    const r = roundTrip('我的电话是13812345678，请回电');
    expect(r.masked).toBe('我的电话是__PII_PHONE_1__，请回电');
    expect(r.restored).toContain('13812345678');
  });

  test('美式电话两种写法', () => {
    const r = roundTrip('Call (555) 123-4567 or 555-987-6543.');
    expect(r.entities.map(e => e.type)).toEqual(['PHONE', 'PHONE']);
    expect(r.restored).toBe('Call (555) 123-4567 or 555-987-6543.');
  });

  test('国际格式电话（+区号）', () => {
    const r = roundTrip('WhatsApp: +86 138 1234 5678');
    expect(r.entities[0].type).toBe('PHONE');
    expect(r.restored).toBe('WhatsApp: +86 138 1234 5678');
  });

  test('银行卡（Luhn 通过才打码）', () => {
    const ok = roundTrip('卡号 4111 1111 1111 1111 已绑定');
    expect(ok.masked).toBe('卡号 __PII_CARD_1__ 已绑定');
    // Luhn 不通过的 16 位数字串不动
    const bad = maskSensitive('订单号 4111 1111 1111 1112 已发货');
    expect(bad.entities).toEqual([]);
  });

  test('身份证（校验码通过才打码）', () => {
    const ok = roundTrip('身份证号110105199001011232已核验');
    expect(ok.masked).toBe('身份证号__PII_IDCARD_1__已核验');
    // 校验码错误的 18 位不作为身份证；也不应被卡号规则误吞（Luhn 不过）
    const bad = maskSensitive('编号110105199001011235无效');
    expect(bad.entities.filter(e => e.type === 'IDCARD')).toEqual([]);
  });

  test('API key：OpenAI / AWS / GitHub / JWT', () => {
    const r = roundTrip(
      'sk-abc123def456ghi789jkl012 与 AKIAIOSFODNN7EXAMPLE 以及 ' +
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789 和 ' +
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P'
    );
    expect(r.entities.map(e => e.type)).toEqual(['KEY', 'KEY', 'KEY', 'KEY']);
    expect(r.masked).not.toMatch(/sk-|AKIA|ghp_|eyJ/);
    expect(r.restored).toContain('AKIAIOSFODNN7EXAMPLE');
  });

  test('财务数字不误伤（千分位/年份/百分比/金额）', () => {
    const text = 'Revenue was $1,234,567 in 2025, up 45% from 830,069. Total assets: 13,500,000,000.';
    expect(maskSensitive(text).entities).toEqual([]);
  });

  test('普通数字串不误伤（发票号/页码范围）', () => {
    expect(maskSensitive('Invoice 20250701-003, pages 13-16, ISBN 978-7-111-12345').entities).toEqual([]);
  });

  test('多实体独立计数 + 顺序', () => {
    const r = roundTrip('a@x.com 和 b@y.com，电话13812345678');
    expect(r.masked).toBe('__PII_EMAIL_1__ 和 __PII_EMAIL_2__，电话__PII_PHONE_1__');
    expect(r.restored).toBe('a@x.com 和 b@y.com，电话13812345678');
  });

  test('空文本/无命中', () => {
    expect(maskSensitive('')).toEqual({ masked: '', entities: [] });
    expect(maskSensitive('hello world').entities).toEqual([]);
  });
});

describe('restoreSensitive — 容错', () => {
  const entities = [{ type: 'EMAIL', serial: 1, value: 'a@x.com' }];

  test('大小写被引擎改写', () => {
    expect(restoreSensitive('邮箱：__pii_email_1__', entities)).toBe('邮箱：a@x.com');
  });

  test('下划线旁被插入空格', () => {
    expect(restoreSensitive('邮箱：__ PII_EMAIL_1 __', entities)).toBe('邮箱：a@x.com');
  });

  test('尾部下划线丢失', () => {
    expect(restoreSensitive('邮箱：__PII_EMAIL_1', entities)).toBe('邮箱：a@x.com');
  });

  test('序号 1 不误吞序号 11', () => {
    const many = [
      { type: 'EMAIL', serial: 1, value: 'first@x.com' },
      { type: 'EMAIL', serial: 11, value: 'eleventh@x.com' },
    ];
    const out = restoreSensitive('__PII_EMAIL_1__ vs __PII_EMAIL_11__', many);
    expect(out).toBe('first@x.com vs eleventh@x.com');
  });

  test('占位符被引擎吞掉：其余照常还原，不报错', () => {
    const many = [
      { type: 'EMAIL', serial: 1, value: 'a@x.com' },
      { type: 'EMAIL', serial: 2, value: 'b@y.com' },
    ];
    expect(restoreSensitive('只剩 __PII_EMAIL_2__', many)).toBe('只剩 b@y.com');
  });

  test('还原值含 $ 等替换特殊字符不被解释', () => {
    const e = [{ type: 'KEY', serial: 1, value: 'sk-aa$&bb$1cc_dd_eexxxxxxxx' }];
    expect(restoreSensitive('__PII_KEY_1__', e)).toBe('sk-aa$&bb$1cc_dd_eexxxxxxxx');
  });
});

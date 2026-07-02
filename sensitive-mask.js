'use strict';

// 敏感信息脱敏（本地正则版，Beta）
// 发送给翻译引擎前把敏感信息替换成占位符（__PII_EMAIL_1__），翻译返回后按
// 记录还原。检测与还原全部在本地完成，原文敏感内容不会离开浏览器。
//
// 精度优先原则：宁可漏检也不误伤——财务文档里到处是数字，电话/卡号的
// 匹配都带校验或强格式约束（Luhn / 身份证 mod-11 / 国际区号前缀），
// 千分位数字（1,234,567）不在分隔符集合里，天然不会命中。
//
// UMD：service worker / Firefox 事件页挂全局 YLSensitive，jest 直接 require。

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.YLSensitive = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {

  // ── 校验器 ──────────────────────────────────────────────────────────────

  // Luhn 校验（银行卡）。13-19 位，过滤掉纯格式巧合的数字串。
  function luhnValid(digits) {
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = digits.charCodeAt(digits.length - 1 - i) - 48;
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return sum % 10 === 0;
  }

  function isValidCard(raw) {
    return luhnValid(raw.replace(/[ -]/g, ''));
  }

  // 中国大陆 18 位身份证：出生日期合理性 + mod-11 校验码，双重校验后误报率极低。
  const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  function isValidCnId(raw) {
    const year = +raw.slice(6, 10), month = +raw.slice(10, 12), day = +raw.slice(12, 14);
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += (raw.charCodeAt(i) - 48) * ID_WEIGHTS[i];
    return ID_CHECK[sum % 11] === raw[17].toUpperCase();
  }

  // ── 检测器（按优先级排列，先命中的先占住区间）────────────────────────────

  const DETECTORS = [
    // 已知前缀的 API key / token（沉浸式的 OneAIFW 至今不支持，是我们的加分项）
    { type: 'KEY', regexes: [
      /\bsk-[A-Za-z0-9_-]{20,}/g,                                        // OpenAI / DeepSeek / Stripe
      /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,                              // GitHub
      /\bAKIA[0-9A-Z]{16}\b/g,                                           // AWS access key
      /\bAIza[0-9A-Za-z_-]{35}\b/g,                                      // Google API key
      /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,                                 // Slack
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
    ] },
    { type: 'EMAIL', regexes: [
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    ] },
    { type: 'IDCARD', regexes: [/(?<!\d)\d{17}[0-9Xx](?!\d)/g], validate: isValidCnId },
    // PHONE 必须先于 CARD：+86 分组号码的纯数字部分可能碰巧通过 Luhn；
    // 反向不会误伤——卡号无 + 前缀，且连续/分隔形态不满足电话正则的边界
    { type: 'PHONE', regexes: [
      /\+\d{1,3}[ -]?\d{2,4}(?:[ -]\d{2,4}){1,4}(?!\d)/g,                // 国际格式（必须带 +）
      /(?<!\d)(?:\(\d{3}\)\s?|\d{3}[-.])\d{3}[-.]\d{4}(?!\d)/g,          // 美式 (555) 123-4567 / 555-123-4567
      /(?<!\d)1[3-9]\d{9}(?!\d)/g,                                       // 中国大陆手机 11 位
    ] },
    { type: 'CARD', regexes: [/(?<!\d)\d(?:[ -]?\d){12,18}(?![\d-])/g], validate: isValidCard },
  ];

  function placeholderFor(type, serial) {
    return `__PII_${type}_${serial}__`;
  }

  /**
   * 打码。返回 { masked, entities }；entities 为空数组表示没有命中，
   * 调用方可跳过 restore。
   */
  function maskSensitive(text) {
    if (!text) return { masked: text, entities: [] };

    const spans = []; // { start, end, type, value }
    const overlaps = (s, e) => spans.some(x => s < x.end && e > x.start);

    for (const det of DETECTORS) {
      for (const re of det.regexes) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const start = m.index, end = m.index + m[0].length;
          if (overlaps(start, end)) continue;
          if (det.validate && !det.validate(m[0])) continue;
          spans.push({ start, end, type: det.type, value: m[0] });
        }
      }
    }
    if (spans.length === 0) return { masked: text, entities: [] };

    // 从后往前替换，避免偏移失效；序号按出现顺序（每类独立计数）。
    spans.sort((a, b) => a.start - b.start);
    const counters = {};
    const entities = spans.map(s => {
      counters[s.type] = (counters[s.type] || 0) + 1;
      return { type: s.type, serial: counters[s.type], value: s.value, start: s.start, end: s.end };
    });
    let masked = text;
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      masked = masked.slice(0, e.start) + placeholderFor(e.type, e.serial) + masked.slice(e.end);
      delete e.start; delete e.end;
    }
    return { masked, entities };
  }

  /**
   * 还原。容忍引擎对占位符的常见改写：大小写变化、下划线旁插空格、
   * 尾部下划线丢失。找不到的占位符跳过（该实体在译文中缺失，只影响
   * 完整性不泄露信息）。
   */
  function restoreSensitive(text, entities) {
    if (!text || !entities || entities.length === 0) return text;
    let out = text;
    // 序号降序还原，避免 _1 命中 _11 的前缀
    const ordered = [...entities].sort((a, b) => b.serial - a.serial);
    for (const e of ordered) {
      const re = new RegExp(
        '_{1,4}\\s*PII[_\\s]+' + e.type + '[_\\s]+' + e.serial + '(?!\\d)\\s*_{0,4}',
        'gi'
      );
      out = out.replace(re, () => e.value);
    }
    return out;
  }

  return { maskSensitive, restoreSensitive };
});

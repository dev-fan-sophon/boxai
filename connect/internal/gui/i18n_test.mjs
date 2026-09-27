import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./assets/i18n.js', import.meta.url), 'utf8');
function language(system, preference, query = '') {
  const context = vm.createContext({
    params: new URLSearchParams(query), navigator: { language: system },
    document: { documentElement: {}, querySelectorAll: () => [] },
  });
  vm.runInContext(source + `;setLocale(${JSON.stringify(preference)});globalThis.result={locale,dict:I18N.vi,t};`, context);
  return context.result;
}

test('English and Vietnamese selection, system detection, and legacy fallback', () => {
  for (const [system, preference, query, expected] of [
    ['vi-VN', 'system', '', 'vi'], ['en-US', 'system', '', 'en'],
    ['zh-CN', 'system', '', 'en'], ['vi-VN', 'en', '', 'en'],
    ['en-US', 'vi', '', 'vi'], ['en-US', 'en', 'locale=vi', 'vi'],
    ['vi-VN', 'zh', '', 'en'], ['vi-VN', 'vi', 'locale=unknown', 'en'],
  ]) assert.equal(language(system, preference, query).locale, expected);
  assert.equal(language('en', 'vi').t('Account'), 'Tài khoản');
  assert.equal(language('vi', 'en').t('Account'), 'Account');
});

test('Vietnamese dictionary preserves placeholders and covers literal UI keys', () => {
  const { dict } = language('vi', 'vi');
  const slots = text => [...text.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
  for (const [key, value] of Object.entries(dict)) {
    assert.ok(value.trim(), key);
    assert.doesNotMatch(value, /\p{Script=Han}/u, key);
    assert.deepEqual(slots(value), slots(key), key);
  }
  for (const file of ['app.js', 'account.js', 'library.js', 'routing.js']) {
    const text = readFileSync(new URL('./assets/' + file, import.meta.url), 'utf8');
    for (const match of text.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) {
      const key = JSON.parse('"' + match[1] + '"');
      assert.ok(key === 'ID' || key in dict, `${file}: ${key}`);
    }
  }
});

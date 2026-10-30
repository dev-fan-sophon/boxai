import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { strings } from './tests/strings.cjs';

const source = readFileSync(new URL('./assets/boxai-i18n.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('./assets/i18n.js', import.meta.url), 'utf8');
function language(system, preference, query = '') {
  const context = vm.createContext({
    window: { bootPrefs: { boxaiOnly: true } },
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

test('Vietnamese dictionary preserves placeholders', () => {
  const { dict } = language('vi', 'vi');
  const slots = text => [...text.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
  for (const [key, value] of Object.entries(dict)) {
    assert.ok(value.trim(), key);
    assert.doesNotMatch(value, /\p{Script=Han}/u, key);
    assert.deepEqual(slots(value), slots(key), key);
  }
});

test('Vietnamese covers literal UI keys in the shell and every built-in plugin', () => {
  const { dict } = language('vi', 'vi');
  const files = readdirSync(new URL('./assets/', import.meta.url), { recursive: true })
    .filter(file => file.endsWith('.js') && !file.endsWith('i18n.js')).sort();
  const missing = new Map();
  const counts = [];
  for (const file of files) {
    const text = readFileSync(new URL('./assets/' + file, import.meta.url), 'utf8');
    const absent = new Set();
    for (const match of text.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
      const key = vm.runInNewContext(match[1]);
      if (key !== 'ID' && !Object.hasOwn(dict, key)) {
        absent.add(key);
        if (!missing.has(key)) missing.set(key, file);
      }
    }
    if (absent.size) counts.push(`${file}: ${absent.size}`);
  }
  assert.equal(missing.size, 0,
    `${missing.size} untranslated literal keys\n${counts.join('\n')}\nFirst missing keys:\n` +
    [...missing].slice(0, 20).map(([key, file]) => `${file}: ${key}`).join('\n'));
});

test('Vietnamese covers catalog keys used by static markup and dynamic selections', () => {
  const { dict } = language('vi', 'vi');
  // The upstream catalog includes data-t markup, conditional t() arguments,
  // backend notices and plugin metadata that a literal-call scan cannot see.
  const { files } = strings();
  const missing = new Set();
  const counts = [];
  for (const { file, dict: catalog } of files) {
    const absent = Object.keys(catalog.zh).filter(key => !Object.hasOwn(dict, key));
    for (const key of absent) missing.add(key);
    if (absent.length) counts.push(`${file}: ${absent.length}`);
  }
  assert.equal(missing.size, 0,
    `${missing.size} untranslated catalog keys\n${counts.join('\n')}\nFirst missing keys:\n` +
    [...missing].slice(0, 20).join('\n'));
});

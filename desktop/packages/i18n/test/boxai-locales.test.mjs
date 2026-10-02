import assert from "node:assert/strict";
import { test } from "vitest";
import { catalogs, en, flattenCatalog, resolveLocale } from "../src/index.ts";

test("Vietnamese, Japanese and Russian system locales resolve without selecting English", () => {
  assert.equal(resolveLocale("vi_VN"), "vi");
  assert.equal(resolveLocale("ja-JP"), "ja");
  assert.equal(resolveLocale("ru-RU"), "ru");
  assert.equal(resolveLocale("unknown-ZZ"), "en");
  assert.equal(catalogs.vi.chat.send, "Gửi");
  assert.equal(catalogs.ja.common.save, "保存");
  assert.equal(catalogs.ru.common.cancel, "Отмена");
});

test("Vietnamese key coverage is complete and translated coverage cannot regress", () => {
  const english = flattenCatalog(en);
  const vietnamese = flattenCatalog(catalogs.vi);
  assert.deepEqual(Object.keys(vietnamese).sort(), Object.keys(english).sort());
  const translated = Object.keys(english).filter((key) => vietnamese[key] !== english[key]);
  // Baseline while the separately owned full Vietnamese catalog is integrated.
  // A copied English catalog must fail even though its key coverage is 100%.
  assert.ok(translated.length >= 200, `Only ${translated.length}/${Object.keys(english).length} Vietnamese strings are translated`);
  for (const key of ["chat.send", "chat.toolCompleted", "chat.permissionAsk", "settings.language", "tray.quit", "nav.projects"]) {
    assert.notEqual(vietnamese[key], english[key], key);
    assert.ok(vietnamese[key].trim(), key);
  }
});

test("every locale presents BoxAI branding", () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    assert.equal(catalog.app.shellName, "BoxAI Desktop", locale);
    for (const value of Object.values(flattenCatalog(catalog))) {
      assert.ok(!value.includes("PI-Desktop"), `${locale}: ${value}`);
    }
  }
});

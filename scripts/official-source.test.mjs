import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const helper = app.slice(app.indexOf('  function renderOfficialSource('), app.indexOf('  function updateResult()'));
const metadata = JSON.parse(readFileSync(new URL('../app/data/kanryo.json', import.meta.url)));
function element() {
  return { children: [], hidden: false, replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); } };
}
function load(sources = metadata.sources) {
  const context = vm.createContext({ META: { sources }, dataIntegrityOk: true, URL,
    document: { createElement: element }, jurisdictionLabel: id => id });
  vm.runInContext(helper, context);
  return context;
}

test('each bureau resolves its own existing official source and replaces previous link', () => {
  const context = load();
  const container = element();
  for (const source of metadata.sources) {
    context.renderOfficialSource(container, source.id);
    assert.equal(container.hidden, false);
    assert.equal(container.children[0].href, source.sourceUrl);
    assert.equal(container.children[0].target, '_blank');
    assert.equal(container.children[0].rel, 'noopener noreferrer');
    assert.match(container.children[0].textContent, /別タブ/);
    assert.match(container.children[1].textContent, /過去取得・保存時点.*推定・仮登録・レターパック/);
    assert.equal(container.children.length, 2);
  }
  context.renderOfficialSource(container, 'unknown');
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);
});

test('missing metadata, unsafe URLs and failed integrity hide stale links', () => {
  for (const sourceUrl of [undefined, '', 'invalid', 'javascript:alert(1)', 'http://houmukyoku.moj.go.jp/x',
    'https://evil.example/x', 'https://houmukyoku.moj.go.jp.evil.example/x',
    'https://user@houmukyoku.moj.go.jp/x', 'https://houmukyoku.moj.go.jp:444/x']) {
    const context = load([{ id: 'tokyo', sourceUrl }]);
    const container = element(); container.children.push({ href: 'stale' });
    context.renderOfficialSource(container, 'tokyo');
    assert.equal(container.hidden, true, String(sourceUrl));
    assert.equal(container.children.length, 0);
  }
  for (const sources of [undefined, {}, []]) {
    const context = load(sources); context.META.sources = sources;
    const container = element(); context.renderOfficialSource(container, 'tokyo');
    assert.equal(container.hidden, true);
  }
  const context = load(); context.dataIntegrityOk = false;
  const container = element(); context.renderOfficialSource(container, 'tokyo');
  assert.equal(container.hidden, true);
});

test('shared renderer tolerates extension templates without source container', () => {
  assert.doesNotThrow(() => load().renderOfficialSource(null, 'tokyo'));
});

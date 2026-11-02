import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const read = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const root = {};
vm.runInNewContext(read("../app/data/office-contacts.js"), { window: root });
vm.runInNewContext(read("../app/office-contacts.js"), { window: root, URL, Date });
const api = root.TOUKI_CONTACTS, registry = root.TOUKI_OFFICE_CONTACTS;
const resolve = (data = registry, bureau = "tokyo", office = "板橋出張所", type = "realEstate") => api.resolve(data, bureau, office, type);
const clone = () => JSON.parse(JSON.stringify({schemaVersion:1,offices:[registry.offices.find(o=>o.id==="tokyo-itabashi")]}));
test("exact bureau/office/type, unknown and missing office", () => {
  assert.equal(resolve().office.id, "tokyo-itabashi");
  assert.equal(resolve().contacts.length, 1);
  assert.equal(resolve().contacts[0].number, "03-3964-5385");
  assert.equal(resolve(registry, "tokyo", "板橋出張所", "commercial").contacts.length, 1);
  assert.equal(resolve(registry, "tokyo", "板橋出張所", "commercial").contacts[0].evidenceMethod, "official_indexed_body");
  assert.equal(resolve(registry, "other").contacts.length, 0);
  assert.equal(resolve(registry, "tokyo", "unknown").contacts.length, 0);
  for (const office of ["", null]) assert.equal(resolve(registry, "tokyo", office), null);
  assert.equal(resolve(registry, "tokyo", "板橋出張所", "unknown"), null);
  assert.equal(resolve({}).contacts.length, 0);
});
test("phone values cannot inject URI controls, extension, SMS or FAX", () => {
  assert.equal(api.phoneHref("03-3964-5385"), "tel:0339645385");
  for (const value of ["", null, {}, "03-3964-5385;ext=3", "tel:0339645385", "+81-3-3964-5385",
    "03-3964-5385\n", "０３-3964-5385", "03 3964 5385", "03-3964-5385?x", "000-0000-0000"]) {
    assert.equal(api.phoneHref(value), "", String(value));
  }
  const data = clone(); data.offices[0].contacts[0].kind = "fax";
  assert.equal(resolve(data).contacts.length, 0);
});
test("unverified, retired, invalid and unsafe sources cannot create actions", () => {
  const mutations = [
    c => c.verificationStatus = "unverified", c => c.status = "withdrawn",
    c => c.withdrawnOn = "2026-11-02", c => c.number = "javascript:alert(1)",
    c => c.verifiedOn = "2026-02-30", c => c.verifiedOn = "2999-01-01",
    c => c.verifiedOn = "", c => c.retrievedOn = "", c => c.purpose = "", c => c.desk = "",
    c => c.evidenceMethod = "unknown", c => c.liveVerified = false,
    ...["javascript:alert(1)", "http://houmukyoku.moj.go.jp/", "https://evil.example/",
      "https://user@houmukyoku.moj.go.jp/", "https://houmukyoku.moj.go.jp:444/"].map(url => c => c.sourceUrl = url)
  ];
  for (const mutate of mutations) {
    const data = clone(); mutate(data.offices[0].contacts[0]);
    assert.equal(resolve(data).contacts.length, 0);
  }
  const data = clone(); data.offices.push(data.offices[0]);
  assert.equal(resolve(data).contacts.length, 0);
  assert.doesNotThrow(() => api.render(null, "tokyo", "板橋出張所", "realEstate"));
});
test("bundles and offline cache include contacts", () => {
  for (const p of ["../app/index.html", "../app/sw.js", "../scraper/build-single.mjs"]) {
    assert.ok(read(p).includes("data/office-contacts.js"), p);
    assert.ok(read(p).includes("office-contacts.js"), p);
  }
  assert.ok(read("../scripts/prepare-pages.mjs").includes('"office-contacts.js"'));
});

test("verification day follows Asia/Tokyo across the UTC date boundary", () => {
  for (const [instant, expected] of [
    ["2026-11-02T14:59:59Z", 0],
    ["2026-11-02T15:00:00Z", 1],
    ["2026-11-02T23:59:59Z", 1],
    ["2026-11-03T00:00:00Z", 1]
  ]) {
    const fixed = new Date(instant).getTime();
    class FixedDate extends Date {
      constructor(value) { super(value === undefined ? fixed : value); }
      static now() { return fixed; }
    }
    const window = {};
    vm.runInNewContext(read("../app/office-contacts.js"), { window, URL, Date: FixedDate, Intl });
    const data = clone(); data.offices[0].contacts[0].verifiedOn = "2026-11-03";
    assert.equal(window.TOUKI_CONTACTS.resolve(data, "tokyo", "板橋出張所", "realEstate").contacts.length, expected, instant);
  }
});

test("every active verified phone resolves for every actual office alias and target type", () => {
  const meta = JSON.parse(read("../app/data/kanryo.json"));
  const ids = new Set();
  for (const office of registry.offices) {
    assert.ok(!ids.has(office.id), "duplicate office ID: " + office.id);
    ids.add(office.id);
    const contactIds = new Set();
    for (const contact of office.contacts) {
      assert.ok(!contactIds.has(contact.id), "duplicate contact ID: " + contact.id);
      contactIds.add(contact.id);
      if (contact.kind !== "phone" || contact.status !== "active" || contact.verificationStatus !== "verified") continue;
      for (const name of office.officeNames) {
        for (const type of contact.registrationTypes) {
          assert.ok(meta.officesByJurisdiction[office.jurisdictionId]?.[type]?.includes(name),
            JSON.stringify([office.id, name, type]) + " must be an actual selectable target");
          const resolved = api.resolve(registry, office.jurisdictionId, name, type);
          assert.ok(resolved?.contacts.some(item => item.id === contact.id),
            contact.id + " must not be silently hidden");
          assert.ok(api.phoneHref(contact.number), contact.id);
        }
      }
    }
  }
});

test("all 421 collected candidates map to adopted UI records with provenance preserved", () => {
  const collection = JSON.parse(read("./fixtures/office-contact-collection.json"));
  assert.equal(collection.candidates.length, 421);
  assert.equal(collection.ledger.length, 421);
  assert.equal(collection.coverage.length, 501);
  assert.equal(registry.offices.length, 413);
  assert.equal(new Set(registry.offices.map(o=>o.jurisdictionId)).size, 50);
  assert.equal(registry.offices.reduce((n,o)=>n+o.contacts.length,0), 422);
  const allIds=registry.offices.flatMap(o=>o.contacts.map(c=>c.id));
  assert.equal(new Set(allIds).size, allIds.length);
  for (const mapping of collection.ledger) {
    const candidate=collection.candidates[mapping.candidateIndex];
    const expectedTypes=collection.coverage.filter(row=>row.status==="candidate" &&
      row.jurisdictionId===candidate.jurisdictionId && row.officeName===candidate.officeName &&
      candidate.registrationTypes.includes(row.registrationType)).map(row=>row.registrationType).sort();
    assert.deepEqual(mapping.assignments.map(a=>a.registrationType).sort(),expectedTypes);
    assert.ok(mapping.assignments.length>0,mapping.candidateId);
    for(const assignment of mapping.assignments){
      const resolved=api.resolve(registry,candidate.jurisdictionId,candidate.officeName,assignment.registrationType);
      const contact=resolved.contacts.find(c=>c.id===assignment.contactId);
      assert.ok(contact,mapping.candidateId+" not resolved");
      assert.equal(contact.number,candidate.number);
      if(assignment.evidencePreference==="preserved_official_live"){
        assert.equal(contact.evidenceMethod,"official_live");
        assert.match(contact.instructions,/3番/);
      }else{
        for(const field of ["desk","purpose","sourceUrl","evidenceMethod","retrievedOn","verifiedOn","sourceUpdatedOn","liveVerified"]){
          assert.equal(contact[field],mapping.fieldOverrides?.[field]?.value ?? candidate[field],mapping.candidateId+" "+field);
        }
      }
    }
  }
});

test("Hiroshima commercial voice menu preserves independently confirmed indexed body", () => {
  const resolved=api.resolve(registry,"hiroshima","本局法人登記部門","commercial");
  assert.equal(resolved.contacts.length,1);
  assert.equal(resolved.contacts[0].number,"082-228-5201");
  assert.match(resolved.contacts[0].desk,/2→3/);
  assert.equal(resolved.contacts[0].evidenceMethod,"official_indexed_body");
});

test("Osaka main office uses its current official landing page instead of removed PDF", () => {
  const expected="https://houmukyoku.moj.go.jp/osaka/table/shikyokutou/all/osaka_lab.html";
  for(const [type,numbers] of [["realEstate",["06-6942-9476","06-6942-9474"]],["commercial",["06-6942-1480"]]]){
    const contacts=api.resolve(registry,"osaka","本局",type).contacts;
    assert.deepEqual(Array.from(contacts,c=>c.number).sort(),numbers.sort());
    for(const contact of contacts){
      assert.equal(contact.sourceUrl,expected);
      assert.equal(contact.evidenceMethod,"official_live");
      assert.equal(contact.liveVerified,true);
      assert.equal(contact.sourceUpdatedOn,"2026-07-08");
    }
  }
  assert.ok(registry.offices.flatMap(o=>o.contacts).every(c=>c.sourceUrl!=="https://houmukyoku.moj.go.jp/osaka/content/001368808.pdf"));
});

test("Osaka rights phone scope is pending corrections/completion and inheritance information", () => {
  const contacts=api.resolve(registry,"osaka","本局","realEstate").contacts;
  const contact=contacts.find(c=>c.number==="06-6942-9476");
  assert.ok(contact);
  assert.match(contact.purpose,/申請中の権利登記の補正・完了確認/);
  assert.match(contact.purpose,/法定相続情報証明制度/);
  assert.doesNotMatch(contact.purpose,/^不動産権利登記に関するお問い合わせ/);
  assert.deepEqual(Array.from(contact.registrationTypes),["realEstate"]);
});

test("495 targets expose exactly collected numbers; six excluded combinations only fall back", () => {
  const collection = JSON.parse(read("./fixtures/office-contact-collection.json"));
  let adopted=0,excluded=0;
  for(const target of collection.coverage){
    const resolved=api.resolve(registry,target.jurisdictionId,target.officeName,target.registrationType);
    assert.ok(resolved);
    const numbers=[...new Set(resolved.contacts.map(c=>c.number))].sort();
    if(target.status==="candidate"){
      adopted++;
      assert.deepEqual(numbers,[...new Set(target.numbers)].sort(),JSON.stringify(target));
    }else{
      excluded++;
      assert.equal(numbers.length,0);
      assert.ok(resolved.exclusion,JSON.stringify(target));
      assert.ok(api.officialUrl(resolved.exclusion.sourceUrl));
    }
  }
  assert.equal(adopted,495);assert.equal(excluded,6);
  const live=resolve().contacts[0];
  assert.equal(live.id,"tokyo-itabashi-registration-phone");
  assert.equal(live.sourceUrl,"https://houmukyoku.moj.go.jp/tokyo/table/shikyokutou/all/itabashi.html");
  assert.equal(live.evidenceMethod,"official_live");assert.equal(live.liveVerified,true);
});

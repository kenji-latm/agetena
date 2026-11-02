// Optional browser QA: PLAYWRIGHT_MODULE may point to an installed Playwright.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const results=[];
 try {
 for(const [name,width,height] of [['pc',1440,1100],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},permissions:['clipboard-read']});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(15000);
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   return url.protocol==='file:' && !url.hostname ? route.continue() : route.abort();
  }); // no telemetry, remote file hosts or external fetch during QA
  await page.addInitScript(()=>{
   localStorage.clear();
   localStorage.setItem('touki_cases_v1',JSON.stringify([{id:'contact-qa',label:'確認用サンプル案件（架空）',jurisdiction:'tokyo',registrationType:'realEstate',office:'板橋出張所',applyDate:'2026-10-26',dueDate:'2026-11-09',done:false}]));
  });
  await page.goto(pathToFileURL(path.resolve(process.env.QA_TARGET || 'app/index.html')).href,{waitUntil:'domcontentloaded',timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#f-office option[value="板橋出張所"]'));
  const collection=JSON.parse(fs.readFileSync(path.resolve('scripts/fixtures/office-contact-collection.json'),'utf8'));
  const coverageFailures=await page.evaluate(coverage=>{
   const failures=[];
   for(const target of coverage){
    const container=document.createElement('div');
    TOUKI_CONTACTS.render(container,target.jurisdictionId,target.officeName,target.registrationType);
    const actual=[...new Set([...container.querySelectorAll('.office-contact__number')].map(el=>el.textContent))].sort();
    if(container.querySelector('button'))failures.push({target,unexpectedContactButton:true});
    const expected=[...new Set(target.numbers)].sort();
    if(JSON.stringify(actual)!==JSON.stringify(expected))failures.push({target,actual,expected});
    const calls=[...container.querySelectorAll('.office-contact__call')].map(el=>el.getAttribute('href')).sort();
    const expectedCalls=expected.map(number=>TOUKI_CONTACTS.phoneHref(number)).sort();
    if(JSON.stringify(calls)!==JSON.stringify(expectedCalls))failures.push({target,calls,expectedCalls});
    if(target.status!=='candidate'&&(!container.textContent.includes('掲載していません')||!container.querySelector('a[href^="https://houmukyoku.moj.go.jp/"]')))failures.push({target,fallback:false});
   }
   return failures;
  },collection.coverage);
  assert.deepEqual(coverageFailures,[],'all 501 actual targets must match DOM phone/tel/fallback coverage');
  const displayFailures=await page.evaluate(()=>{
   const failures=[];
   for(const office of TOUKI_OFFICE_CONTACTS.offices){
    for(const contact of office.contacts){
     if(contact.kind!=='phone'||contact.status!=='active'||contact.verificationStatus!=='verified')continue;
     for(const name of office.officeNames)for(const type of contact.registrationTypes){
      const container=document.createElement('div');
      TOUKI_CONTACTS.render(container,office.jurisdictionId,name,type);
      const displayed=[...container.querySelectorAll('.office-contact__number')].map(el=>el.textContent);
      const hrefs=[...container.querySelectorAll('.office-contact__call')].map(el=>el.getAttribute('href'));
      if(!displayed.includes(contact.number)||!hrefs.includes(TOUKI_CONTACTS.phoneHref(contact.number)))
       failures.push([office.id,contact.id,name,type]);
      const entry=[...container.querySelectorAll('.office-contact__entry')].find(el=>el.querySelector('.office-contact__number')?.textContent===contact.number);
      if(!entry||!entry.textContent.includes(contact.evidenceMethod==='official_indexed_body'?'公式掲載情報の確認日（検索経由）':'公式ページを直接取得'))
       failures.push([office.id,contact.id,name,type,'evidence-label']);
      if(contact.evidenceMethod==='official_indexed_body'&&entry?.textContent.includes('直接取得'))
       failures.push([office.id,contact.id,'indexed-mislabeled-live']);
     }
    }
   }
   return failures;
  });
  assert.deepEqual(displayFailures,[],'all active verified phones must reach actual UI nodes');
  const selectOffice=async value=>{
   if(await page.locator('#office-picker-toggle').isVisible()) await page.locator('#office-picker-toggle').click();
   await page.selectOption('#f-office',value);
  };
  await selectOffice('板橋出張所');
  const summary=page.locator('#result-source summary');
  await summary.waitFor();
  assert.equal(await summary.textContent(),'☎ 連絡先');
  if(process.env.QA_SCREENSHOT_DIR){
   fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});
   await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,name+'-contact-closed.png'),fullPage:true});
  }
  for(let i=0;i<5;i++){await summary.click();assert.equal(await page.locator('#result-source details').getAttribute('open'),'');await summary.click();assert.equal(await page.locator('#result-source details').getAttribute('open'),null)}
  await summary.focus();await page.keyboard.press('Enter');
  if(process.env.QA_SCREENSHOT_DIR){
   await page.locator('.item__official-source summary').click();
   await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,name+'-contact-expanded.png'),fullPage:true});
   await page.locator('.item__official-source summary').click();
  }
  assert.match(await page.locator('#result-source .office-contact__panel').textContent(),/代表.*不動産登記申請/s);
  assert.equal(await page.locator('#result-source .office-contact__call').getAttribute('href'),'tel:0339645385');
  assert.equal(await page.locator('#result-source .office-contact__call').isVisible(),name==='mobile');
  assert.equal(await page.locator('#result-source .office-contact__panel button').count(),0);
  const number=page.locator('#result-source .office-contact__number');
  await number.scrollIntoViewIfNeeded();
  assert.equal(await number.evaluate(el=>getComputedStyle(el).userSelect),'text');
  const textRect=await number.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const r=range.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}});
  await page.mouse.move(textRect.x-1,textRect.y+textRect.height/2);
  await page.mouse.down();
  await page.mouse.move(textRect.x+textRect.width+1,textRect.y+textRect.height/2,{steps:12});
  await page.mouse.up();
  assert.equal(await page.evaluate(()=>getSelection().toString()),'03-3964-5385');
  await page.keyboard.press('Control+c');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'03-3964-5385');
  await summary.focus();
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.className),name==='mobile'?'office-contact__call':'office-contact__source');
  await selectOffice('新宿出張所');
  assert.equal(await page.locator('#result-source details').getAttribute('open'),null);
  await summary.click();assert.equal(await page.locator('#result-source [href^="tel:"]').count(),1);
  assert.match(await page.locator('#result-source .office-contact__panel').textContent(),/公式掲載情報の確認日（検索経由）/);
  assert.match(await page.locator('#result-source .office-contact__panel').textContent(),/現在の番号・案内は公式ページで確認/);
  assert.doesNotMatch(await page.locator('#result-source .office-contact__panel').textContent(),/直接取得/);
  await page.locator('input[name=registration-type][value=commercial]').locator('..').click();
  assert.equal(await page.locator('#result-source details').getAttribute('open'),null);
  const saved=page.locator('.item__official-source summary');
  await saved.click();
  assert.equal(await page.locator('.item__official-source .office-contact__panel button').count(),0);
  assert.equal(await page.locator('.item__official-source [href^="tel:"]').getAttribute('href'),'tel:0339645385');
  assert.equal(await page.locator('.item__actions button').count(),4);
  await page.evaluate(()=>{const s=document.querySelector('#f-office');const o=document.createElement('option');o.value='';o.textContent='選択なし';s.appendChild(o);s.value='';s.dispatchEvent(new Event('change'))});
  assert.equal(await page.locator('#result-source details').count(),0);
  // Unknown office and bureau have no inferred numbers. User-supplied labels remain text.
  await page.evaluate(()=>{const c=document.createElement('div');c.id='unknown-contact';document.body.appendChild(c);TOUKI_CONTACTS.render(c,'unknown','板橋出張所','realEstate')});
  assert.equal(await page.locator('#unknown-contact [href^="tel:"]').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  results.push({viewport:name,passed:['all 501 DOM phone/tel and six excluded fallbacks','no contact copy buttons in all targets','all adopted records and evidence labels','repeat open/close','Enter/Space/Escape','focus return and Tab order','validated tel and responsive call','normal mouse text selection and OS keyboard copy','office/type switch closes','indexed-source labeling','saved-case mapping independent','four existing case actions','unselected hides','unknown bureau','no overflow','no JS errors']});
  await context.close();
 }
 console.log(JSON.stringify(results,null,2));
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

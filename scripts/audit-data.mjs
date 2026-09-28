import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function auditData(meta, now=Date.now(), maxAgeHours=3) {
 const issues=[], rows=[];
 const age=(now-Date.parse(meta.generatedAt))/3600000;
 if(!Number.isFinite(age)||age>maxAgeHours||age< -0.1) issues.push('公開データの更新時刻が古いか不正です');
 if(meta.jurisdictions?.length!==50) issues.push('50法務局の一覧がそろっていません');
 for(const j of meta.jurisdictions||[]) {
  const source=meta.sources?.find(s=>s.id===j.id);
  let count=0,latest='';
  if(!source||source.fetchError) issues.push(`${j.label}: ${source?.fetchError||'取得結果なし'}`);
  for(const [type,offices]of Object.entries(meta.publishedDates?.[j.id]||{})) for(const [office,dates]of Object.entries(offices)) for(const date of dates) {
   count++;if(date>latest)latest=date;
   const due=meta.data?.[j.id]?.[type]?.[office]?.[date];
   if(!/^\d{4}-\d{2}-\d{2}$/.test(due||'')||due<date)issues.push(`${j.label} ${office}: 日付不整合 ${date} / ${due}`);
  }
  if(!count)issues.push(`${j.label}: 現在取得できた日付が0件です`);
  if(latest&&(now-Date.parse(latest+'T00:00:00+09:00'))>14*86400000)issues.push(`${j.label}: 掲載日付が14日以上更新されていません`);
  rows.push({id:j.id,label:j.label,count,latest,error:source?.fetchError||null});
 }
 return {generatedAt:meta.generatedAt,checkedAt:new Date(now).toISOString(),ageHours:Math.round(age*10)/10,issues,rows};
}
async function main() {
 const target=process.argv[2]||'app/data/kanryo.json';
 const remote=/^https:/.test(target);
 const response=remote?await fetch(target+'?_='+Date.now(),{signal:AbortSignal.timeout(30000)}):null;
 if(response&&!response.ok)throw new Error('公開データ HTTP '+response.status);
 const meta=JSON.parse(remote?await response.text():fs.readFileSync(target,'utf8'));
 const result=auditData(meta,Date.now(),Number(process.env.AUDIT_MAX_AGE_HOURS||3));
 if(remote){
  const integrity=await fetch(new URL('kanryo-integrity.js?_='+Date.now(),target),{signal:AbortSignal.timeout(30000)});
  if(!integrity.ok)throw new Error('検証用データ HTTP '+integrity.status);
  const text=await integrity.text();
  const hash=crypto.createHash('sha256').update(JSON.stringify(meta)).digest('hex');
  if(!text.includes(hash))result.issues.push('公開JSONと検証用ハッシュが一致しません');
 }
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`stale=${result.ageHours>3}\n`);
 console.log(JSON.stringify(result,null,2));
 if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## 完了予定日データ監査\n最終取得: ${result.generatedAt}\n\n|法務局|取得件数|最新申請日|\n|---|---:|---|\n`+result.rows.map(r=>`|${r.label}|${r.count}|${r.latest||'なし'}|`).join('\n')+'\n\n'+result.issues.join('\n'));
 if(result.issues.length)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const attempts=process.argv.includes('--retry')?3:1;
  for(let attempt=1;attempt<=attempts;attempt++){
    process.exitCode=0;
    try{await main();}catch(error){console.error(error.message);process.exitCode=1;}
    if(!process.exitCode||attempt===attempts)break;
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
}

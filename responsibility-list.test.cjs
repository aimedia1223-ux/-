const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const exportsForTest={};
const source=ts.transpileModule(fs.readFileSync('src/utils/loadResponsibilityList.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(source,{exports:exportsForTest,require:()=>({getJobResponsibilities:()=>{throw new Error('read not injected');}})});
const load=exportsForTest.loadResponsibilityList;
test('一覧は保存済み・未登録・取得失敗を区別し、失敗した案件のせいで正常な保存済みを隠さない',async()=>{
 const rows=await load([{id:'saved',title:'保存済み案件'},{id:'empty',title:'未登録案件'},{id:'denied',title:'取得失敗案件'}],async id=>{
  if(id==='denied')throw new Error('SECRET permission denied');
  return {contacts:id==='saved'?{version:1,sb_contact_name:'架空担当者'}:null,candidates:[]};
 });
 assert.deepEqual(Array.from(rows,r=>r.status),['saved','unregistered','error']);
 assert.equal(rows[0].contacts.sb_contact_name,'架空担当者');assert.equal(rows[2].contacts,null);
 assert.equal(JSON.stringify(rows).includes('SECRET'),false);
});
test('再度開くと前の表示を使い回さず、保存先から更新された内容を読み直す',async()=>{
 let version=1,calls=0;
 const read=async()=>{calls++;return {contacts:{version},candidates:[]};};
 const jobs=[{id:'j',title:'架空案件'}];
 assert.equal((await load(jobs,read))[0].contacts.version,1);
 version=2;assert.equal((await load(jobs,read))[0].contacts.version,2);assert.equal(calls,2);
});
test('案件が多くても同時取得は3件までに抑え、順序と取得できた結果を維持する',async()=>{
 let active=0,maximum=0;
 const jobs=Array.from({length:8},(_,n)=>({id:String(n),title:String(n)}));
 const rows=await load(jobs,async id=>{
  active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;
  return {contacts:{version:Number(id)+1},candidates:[]};
 });
 assert.equal(maximum,3);assert.deepEqual(Array.from(rows,r=>r.jobId),jobs.map(j=>j.id));
 assert.deepEqual(Array.from(rows,r=>r.contacts.version),[1,2,3,4,5,6,7,8]);
});

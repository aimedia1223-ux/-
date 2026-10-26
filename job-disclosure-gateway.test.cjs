const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(response){
 const calls=[];
 const supabase={rpc:async(...args)=>{calls.push(args);return response;}};
 function evaluate(file){
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(source,{exports,require:name=>name==='./jobResponsibilities' ? evaluate('src/lib/jobResponsibilities.ts') : {supabase}});
  return exports;
 }
 return {api:evaluate('src/lib/jobDisclosure.ts'),calls};
}
test('概要は専用RPCのみで取得し、余分な機密フィールドを画面へ渡さない',async()=>{
 const {api,calls}=load({data:[{public_id:'opaque',region:'関東',category:'店舗運営支援',exact_location:'SECRET'}],error:null});
 const rows=await api.listJobSummaries();assert.equal(JSON.stringify(rows).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_list_job_summaries']]);
});
test('承諾済みフラグや会社・スタッフを送らず、毎回本人の承諾を問い合わせる',async()=>{
 const {api,calls}=load({data:{title:'承諾済み詳細',company_name:'A',description:'内容',price:'10000',document_reference:'PRIVATE'},error:null});
 const first=await api.readApprovedJob('opaque');await api.readApprovedJob('opaque');
 assert.equal(first.price,10000);assert.equal('document_reference' in first,false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),Array(2).fill(['connexy_read_approved_job',{target_public_id:'opaque'}]));
});
test('通信・権限エラーや不正な概要で代替データを表示せず、生のエラーを出さない',async()=>{
 for(const response of [{data:null,error:{code:'42501',message:'SECRET'}},{data:{},error:null},{data:[{public_id:'id',region:'SECRET',category:'店舗運営支援'}],error:null}]){
  const {api}=load(response);await assert.rejects(api.listJobSummaries(),e=>!e.message.includes('SECRET'));
 }
});
test('詳細拒否・不正な応答は表示せず、前回結果をキャッシュして返さない',async()=>{
 for(const response of [{data:null,error:{message:'SECRET'}},{data:{title:'X'},error:null},{data:{title:'X',description:'X',company_name:'X',price:'bad'},error:null}]){
  const {api}=load(response);await assert.rejects(api.readApprovedJob('id'),e=>/開示できません/.test(e.message)&&!e.message.includes('SECRET'));
 }
});

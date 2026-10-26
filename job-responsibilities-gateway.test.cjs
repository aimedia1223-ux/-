const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const contacts={version:1,updated_at:'2026-10-25T00:00:00Z',is_current:true,
 sb_contact_staff_id:'s',sb_contact_name:'架空担当者',agency_contact_staff_id:'s',agency_contact_name:'架空担当者',incident_contact_staff_id:'s',incident_contact_name:'架空担当者'};
function load(response){
 const calls=[],exports={};
 const source=ts.transpileModule(fs.readFileSync('src/lib/jobResponsibilities.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(source,{exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);return response;}}})});
 return {api:exports,calls};
}
test('登録内容は専用RPCのみで取得し、未登録を正常な状態として扱う',async()=>{
 const {api,calls}=load({data:{contacts:null,candidates:[{id:'s',name:'架空担当者',password:'SECRET'}]},error:null});
 const data=await api.getJobResponsibilities('job');assert.equal(data.contacts,null);assert.equal(JSON.stringify(data).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_get_job_responsibilities',{target_job:'job'}]]);
});
test('保存時は案件・3つの担当者・取得した版だけを送り、会社や管理者権限・更新者を自己申告しない',async()=>{
 const {api,calls}=load({data:{...contacts,updated_by:'SECRET'},error:null});
 const data=await api.saveJobResponsibilities({jobId:'job',sbContact:'s',agencyContact:'s',incidentContact:'s',expectedVersion:0});
 assert.equal(data.version,1);assert.equal(JSON.stringify(data).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_save_job_responsibilities',{target_job:'job',sb_contact:'s',agency_contact:'s',incident_contact:'s',expected_version:0}]]);
});
test('権限・競合・入力・通信エラーで保存成功にせず、生エラーを表示しない',async()=>{
 for(const [code,pattern] of [['42501',/管理者権限/],['40001',/別の更新/],['22023',/有効な担当者/],['PGRST202',/119番SQL/]]){
  const {api}=load({data:null,error:{code,message:'SECRET'}});
  await assert.rejects(api.getJobResponsibilities('job'),e=>pattern.test(e.message)&&!e.message.includes('SECRET'));
  await assert.rejects(api.saveJobResponsibilities({jobId:'job',sbContact:'s',agencyContact:'s',incidentContact:'s',expectedVersion:1}),e=>pattern.test(e.message)&&!e.message.includes('SECRET'));
 }
});
test('欠落・不正形式・無効担当者の応答を保存成功として扱わない',async()=>{
 for(const data of [null,{...contacts,version:0},{...contacts,sb_contact_name:null},{...contacts,is_current:false}]){
  const {api}=load({data,error:null});
  await assert.rejects(api.saveJobResponsibilities({jobId:'job',sbContact:'s',agencyContact:'s',incidentContact:'s',expectedVersion:0}));
 }
 const {api}=load({data:{contacts,candidates:null},error:null});await assert.rejects(api.getJobResponsibilities('job'));
});

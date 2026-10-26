const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const manager={manager_staff_id:'s',manager_name:'架空担当者',is_current:true,version:1,updated_at:'2026-10-25T00:00:00Z'};
function load(response){const calls=[];const supabase={rpc:async(...args)=>{calls.push(args);return response;}};
 function evaluate(file){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>name==='./jobResponsibilities'?evaluate('src/lib/jobResponsibilities.ts'):{supabase}});return exports;}
 return {api:evaluate('src/lib/agencyManagers.ts'),calls};}
test('一覧は本人用の専用RPCのみで取得し、任意の会社・スタッフを要求しない',async()=>{
 const {api,calls}=load({data:{items:[],candidates:[{id:'s',name:'架空担当者',password:'SECRET'}]},error:null});
 assert.equal(JSON.stringify(await api.listAgencyManagers()).includes('SECRET'),false);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_list_agency_managers']]);
});
test('保存時に承諾ID・担当者・版だけを送り、自己申告の承諾済み/会社/管理者権限を送らない',async()=>{
 const {api,calls}=load({data:{...manager,updated_by:'SECRET'},error:null});assert.equal(JSON.stringify(await api.saveAgencyManager('proof','s',0)).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_save_agency_manager',{target_approval:'proof',manager_staff:'s',expected_version:0}]]);
});
test('権限・競合・入力・通信エラーは成功にせず、生のエラーを表示しない',async()=>{
 for(const code of ['42501','40001','23505','22023','PGRST202']){const {api}=load({data:null,error:{code,message:'SECRET'}});
  await assert.rejects(api.listAgencyManagers(),e=>!e.message.includes('SECRET'));await assert.rejects(api.saveAgencyManager('proof','s',0),e=>!e.message.includes('SECRET'));}
});
test('保存結果の欠落・不正な版・無効な担当者を保存成功として扱わない',async()=>{
 for(const data of [null,{}, {...manager,version:0},{...manager,is_current:false}]){const {api}=load({data,error:null});await assert.rejects(api.saveAgencyManager('proof','s',0));}
});

const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const entry={id:'1',occurred_at:'2026-10-25T00:00:00Z',action:'message.sent',actor_kind:'own',actor_staff_id:'s',actor_name:'架空担当者',target_type:'message',target_id:'3',version:null,item_count:null};
function load(response){const calls=[],exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/auditLog.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
 {exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);return response;}}})});return{api:exports,calls};}
test('監査取得に会社や役割を自己申告せず、本文/UID/余分な属性を破棄する',async()=>{
 const{api,calls}=load({data:{items:[{...entry,body:'SECRET',actor_uid:'SECRET',company_id:'SECRET'}],has_more:true,next_before_id:'1'},error:null});
 const result=await api.listAuditEvents('change','4');assert.equal(JSON.stringify(result).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_list_audit_events',{before_id:'4',event_group:'change'}]]);
 const other=load({data:{items:[{...entry,actor_kind:'counterparty',actor_name:'SECRET',actor_staff_id:'SECRET'}],has_more:false,next_before_id:null},error:null});
 assert.equal(JSON.stringify(await other.api.listAuditEvents()).includes('SECRET'),false);
});
test('未適用・権限・通信失敗を記録なし扱いにせず、生のエラーを表示しない',async()=>{
 for(const code of ['42501','22023','PGRST202',undefined]){const{api}=load({data:null,error:{code,message:'SECRET'}});await assert.rejects(api.listAuditEvents(),e=>!e.message.includes('SECRET'));}
});
test('不正な時刻・アクション・カーソル・件数を監査記録として表示しない',async()=>{
 for(const data of [null,{}, {items:[{...entry,occurred_at:'invalid'}],has_more:false,next_before_id:null},
 {items:[{...entry,action:'__proto__'}],has_more:false,next_before_id:null},
 {items:[{...entry,item_count:-1}],has_more:false,next_before_id:null},
 {items:[],has_more:true,next_before_id:null}]){const{api}=load({data,error:null});await assert.rejects(api.listAuditEvents());}
});

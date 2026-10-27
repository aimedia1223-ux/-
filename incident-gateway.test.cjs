const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const id='00000000-0000-4000-8000-000000000011',date='2026-10-27T00:00:00Z';
const row={id,category:'loss',status:'reported',created_at:date,version:1};
const detail={...row,discovered_at:date,updated_at:date,summary:'架空の報告',initial_action:'',reporter_staff_id:'s',history:[{version:1,actor_staff_id:'s',status:'reported',note:'初回',evidence_state:'unconfirmed',external_state:'unreported',occurred_at:date}]};
function load(response){const calls=[],exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/incidents.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);return response;}}})});return{api:exports,calls};}
test('本人用RPCだけを使い、一覧・詳細に余分なUIDを返さない',async()=>{
 let{api,calls}=load({data:{items:[{...row,reporter_uid:'SECRET'}],contact:null,can_manage:false},error:null});assert.equal(JSON.stringify(await api.listIncidents()).includes('SECRET'),false);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_list_incidents']]);
 ({api,calls}=load({data:{...detail,reporter_uid:'SECRET'},error:null}));assert.equal(JSON.stringify(await api.readIncident(id)).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_read_incident',{target_report:id}]]);
 const template=api.incidentTemplate(detail);assert.match(template,/下書き/);assert.match(template,/送信は行っていません/);
});
test('報告ID・版を渡し、会社・報告者・権限の自己申告をしない',async()=>{
 let{api,calls}=load({data:id,error:null});await api.createIncident(id,'loss',date,'架空検証の紛失報告です。','未確認');assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['connexy_create_incident',{report_id:id,report_category:'loss',discovered:date,report_summary:'架空検証の紛失報告です。',initial_actions:'未確認'}]);
 ({api,calls}=load({data:null,error:null}));await api.updateIncident(id,2,'investigating','調査','unconfirmed','unreported');assert.equal(calls[0][1].expected_version,2);assert.equal('company_id' in calls[0][1],false);
});
test('権限・競合・未適用・不正な応答を成功として表示しない',async()=>{
 for(const code of ['42501','40001','22023','PGRST202']){const{api}=load({data:null,error:{code,message:'SECRET'}});await assert.rejects(api.listIncidents(),e=>!e.message.includes('SECRET'));await assert.rejects(api.readIncident(id));await assert.rejects(api.updateIncident(id,1,'reported','メモ','unconfirmed','unreported'));}
 for(const data of [null,{...detail,id:'bad'},{...detail,history:[]},{...detail,status:'invalid'},{...detail,version:2}]){const{api}=load({data,error:null});await assert.rejects(api.readIncident(id));}
});

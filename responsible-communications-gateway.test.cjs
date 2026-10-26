const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const scope={approval_id:'proof',job_title:'架空案件',side:'client',primary_version:1,manager_version:2,primary_name:'A',manager_name:'B'};
function load(response){const calls=[],exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/responsibleCommunications.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
 {exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);return response;}}})});return{api:exports,calls};}
test('専用連絡APIは宛先・会社・権限を自己申告せず、取得結果の余分な項目も破棄',async()=>{
 let {api,calls}=load({data:[{...scope,secret:'SECRET'}],error:null});assert.equal(JSON.stringify(await api.listResponsibleThreads()).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_list_responsible_threads']]);
 ({api,calls}=load({data:{scope,messages:[{id:'3',side:'agency',body:'架空',created_at:'2026-10-25',sender_uid:'SECRET'}]},error:null}));
 assert.equal(JSON.stringify(await api.readResponsibleMessages('proof','5')).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_read_responsible_messages',{target_approval:'proof',before_id:'5'}]]);
 ({api,calls}=load({data:{id:'7'},error:null}));assert.equal(await api.sendResponsibleMessage({...scope,recipient:'arbitrary'},'本文','nonce'),'7');
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_send_responsible_message',{target_approval:'proof',message_body:'本文',request_id:'nonce',expected_primary_version:1,expected_manager_version:2}]]);
});
test('未適用・拒否・競合・通信失敗は空一覧や成功にせず、生のサーバー情報を表示しない',async()=>{
 for(const code of ['42501','40001','22023','PGRST202',undefined]){const{api}=load({data:null,error:{code,message:'SECRET'}});
 for(const operation of [()=>api.listResponsibleThreads(),()=>api.readResponsibleMessages('p'),()=>api.sendResponsibleMessage(scope,'本文','n')])await assert.rejects(operation(),e=>!e.message.includes('SECRET'));}
});
test('壊れた応答を連絡先や送信成功として扱わない',async()=>{
 for(const data of [null,{},[{...scope,manager_version:0}],[{...scope,side:'staff'}]]){const{api}=load({data,error:null});await assert.rejects(api.listResponsibleThreads());}
 for(const data of [null,{id:1},{id:'NaN'}]){const{api}=load({data,error:null});await assert.rejects(api.sendResponsibleMessage(scope,'本文','n'));}
 const{api}=load({data:{scope,messages:[{id:'9',side:'staff',body:'bad',created_at:'now'}]},error:null});await assert.rejects(api.readResponsibleMessages('proof'));
});

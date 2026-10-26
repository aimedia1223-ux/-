const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function setup(response){const calls=[],exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/contractAmendments.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({supabase:{rpc:async(...args)=>{calls.push(args);return response;}}})});return{api:exports,calls};}
const details={tax:'税込',expenses:'なし',payment_due:'2026-11-30',inspection_due:'2026-11-05',termination:'条件',intellectual_property:'条件',liability:'条件'};
test('変更提示は版・内容・理由だけを送り、会社・同意者・確定日時を自己申告しない',async()=>{
 const{api,calls}=setup({data:'request-id',error:null});assert.equal(await api.proposeContractAmendment({requestId:'request-id',offerId:'offer-id',version:2,terms:' 条件 ',details,reason:' 理由 '}),'request-id');
 assert.equal(calls[0][0],'connexy_propose_contract_amendment');assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{request_id:'request-id',target_offer:'offer-id',expected_version:2,contract_terms:'条件',contract_details:details,change_reason:'理由'});
});
test('相手方の回答は提示IDと操作だけを送り、欠落した版を成功扱いしない',async()=>{
 const{api,calls}=setup({data:3,error:null});assert.equal(await api.respondContractAmendment('request-id','confirm'),3);assert.deepEqual(Object.keys(calls[0][1]).sort(),['action','target_amendment']);
 for(const data of [null,1,{},'3'])await assert.rejects(setup({data,error:null}).api.respondContractAmendment('id','confirm'));
 assert.equal(await setup({data:null,error:null}).api.respondContractAmendment('id','decline'),null);
});
test('履歴は余分な本人UIDを破棄し、版の欠落・重複・不正な応答を拒否する',async()=>{
 const data={offer_id:'offer-id',contract_id:'ct_offer-id',client_id:'a',agency_id:'b',work_dates:['2026-11-04'],can_propose:true,versions:[{version:1,terms:'条件',details,confirmed_at:'2026-10-26T01:00:00Z',sha256:'a'.repeat(64),change_reason:null,responded_by:'SECRET_UID'}],amendments:[],created_by:'SECRET_UID'};
 const good=setup({data,error:null});assert.equal(JSON.stringify(await good.api.getContractHistory('offer-id')).includes('SECRET_UID'),false);assert.equal(good.calls[0][0],'connexy_get_contract_history');assert.deepEqual(Object.keys(good.calls[0][1]),['target_offer']);
 for(const bad of [null,{...data,offer_id:'other'},{...data,versions:[]},{...data,versions:[{...data.versions[0],version:2}]},{...data,can_propose:null},{...data,versions:[{...data.versions[0],sha256:'bad'}]}])await assert.rejects(setup({data:bad,error:null}).api.getContractHistory('offer-id'));
});
test('競合・拒否・重複・未適用を成功とせず生の秘密情報を表示しない',async()=>{
 for(const code of ['42501','40001','23505','22023','NETWORK'])await assert.rejects(setup({data:null,error:{code,message:'SECRET_SERVER_DETAILS'}}).api.getContractHistory('id'),e=>!e.message.includes('SECRET_SERVER_DETAILS'));
});

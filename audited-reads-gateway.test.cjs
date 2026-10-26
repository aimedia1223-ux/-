const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(response){const calls=[];function evaluate(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
 {exports,require:name=>name.endsWith('readColumns')?evaluate('src/data/readColumns.ts'):{supabase:{rpc:async(...args)=>{calls.push(args);const r=typeof response==='function'?response(args):response;
 return args[0]==='connexy_read_data'&&Array.isArray(r.data)?{...r,data:{rows:r.data,scope:r.scope??['uid','demoa','s','admin']}}:r;}}}});return exports;}
 return{api:evaluate('src/lib/auditedReads.ts'),calls};}
test('通常取得は会社やロールを権限として渡さず、固定列以外を破棄する',async()=>{
 const{api,calls}=load({data:[{id:'s',user_id:'demoa',name:'架空',password:'SECRET',new_secret:'SECRET'}],error:null});
 assert.equal(JSON.stringify(await api.readAuditedRows('staffs',{company:'demoa'})).includes('SECRET'),false);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_read_data',{target_table:'staffs',target_id:null,target_company:'demoa',page_size:200,page_offset:0}]]);
});
test('200件を越える取得は上限付きで続き、不完全なページを成功扱いにしない',async()=>{
 const{api,calls}=load(args=>({data:Array.from({length:args[1].page_offset===0?200:args[1].page_size},(_,n)=>({id:String(n+args[1].page_offset)})),error:null}));
 assert.equal((await api.readAuditedRows('jobs',{limit:201})).length,201);assert.equal(calls[1][1].page_size,1);assert.equal(calls[1][1].page_offset,200);
 const failing=load(args=>args[1].page_offset===0?{data:Array.from({length:200},(_,n)=>({id:String(n)})),error:null}:{data:null,error:{code:'42501'}});
 await assert.rejects(failing.api.readAuditedRows('jobs'),e=>e.code==='42501');
 const changed=load(args=>({data:Array.from({length:200},(_,n)=>({id:String(n)})),scope:['uid',args[1].page_offset===0?'demoa':'demob','s','admin'],error:null}));
 await assert.rejects(changed.api.readAuditedRows('jobs'),/アカウント・所属・権限/);
});
test('CSVは宛先・会社・列を受け取らない専用RPCだけで生成する',async()=>{
 const{api,calls}=load({data:{csv:'スタッフID,氏名,表示名',filename:'Connexy_staffs.csv',count:0,extra:'SECRET'},error:null});
 assert.equal(JSON.stringify(await api.getStaffCsv()).includes('SECRET'),false);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['connexy_export_staff_csv']]);
});
test('通信失敗・不正な行・ファイル名・件数をダウンロード成功にしない',async()=>{
 for(const data of [null,{},[{name:'no-id'}]]){const{api}=load({data,error:null});await assert.rejects(api.readAuditedRows('staffs'));}
 for(const data of [null,{csv:'x',filename:'../../secret.csv',count:1},{csv:'x',filename:'Connexy_staffs.csv',count:-1}]){const{api}=load({data,error:null});await assert.rejects(api.getStaffCsv());}
 for(const code of ['42501','PGRST202']){const{api}=load({data:null,error:{code,message:'SECRET'}});await assert.rejects(api.getStaffCsv(),e=>!e.message.includes('SECRET'));}
});

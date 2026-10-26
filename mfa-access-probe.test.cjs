const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/mfaAccessProbe.ts','utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject});
const {probeBeforeMfa}=exportsObject;
function setup({uid='C',aal='aal1',override={}}={}){
  const calls=[];
  const empty={data:[],error:null};
  const response=name=>override[name]||empty;
  const client={
    auth:{getUser:async()=>({data:{user:{id:uid}},error:null}),
      mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:aal},error:null})}},
    rpc:async name=>{calls.push(name);return response('identity');},
    from:table=>{
      calls.push(table);
      let filter='';
      const query={select:()=>query,eq:(_col,id)=>{filter=id;return query;},limit:async()=>response(filter||table)};
      return query;
    },
  };
  return {client,calls};
}
test('AAL1で本人情報・6業務表・案件ID直接指定・所属管理表の拒否を確認する',async()=>{
  const {client,calls}=setup();
  const checks=await probeBeforeMfa(client,'C');
  assert.equal(checks.length,12);
  assert.equal(checks.every(c=>c.passed),true);
  assert.equal(calls.filter(c=>c==='jobs').length,4);
});
test('別アカウントや追加認証済みなら業務APIを実行しない',async()=>{
  for(const options of [{uid:'A'},{aal:'aal2'},{aal:null}]){
    const {client,calls}=setup(options);
    await assert.rejects(probeBeforeMfa(client,'C'));
    assert.equal(calls.length,0);
  }
});
test('1件でも取得できた場合は失敗し、取得内容を判定結果へ含めない',async()=>{
  const {client}=setup({override:{'connexy-access-test-a':{data:[{id:'sensitive-value'}],error:null}}});
  const checks=await probeBeforeMfa(client,'C');
  assert.equal(checks.filter(c=>!c.passed).length,1);
  assert.equal(JSON.stringify(checks).includes('sensitive-value'),false);
});
test('通信・スキーマ・JWTのエラーをアクセス拒否成功と混同しない',async()=>{
  for(const code of ['NETWORK','42P01','PGRST301']){
    const {client}=setup({override:{jobs:{data:null,error:{code}}}});
    const checks=await probeBeforeMfa(client,'C');
    assert.equal(checks.find(c=>c.label==='案件情報を取得できない').passed,false);
  }
});
test('PostgreSQLの権限拒否42501は拒否成功として扱う',async()=>{
  const {client}=setup({override:{identity:{data:null,error:{code:'42501'}}}});
  assert.equal((await probeBeforeMfa(client,'C'))[1].passed,true);
});

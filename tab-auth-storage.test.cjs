const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {createClient}=require('@supabase/supabase-js');
function load(file,mocks={},extra={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:n=>mocks[n],URL,...extra});return exports;
}
const {createTabAuthStorage}=load('src/lib/tabAuthStorage.ts');
const project='https://tab-test.supabase.co';
function store(){const data=new Map();return{data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
function setup(session=store(),persistent=store(),id='00000000-0000-4000-8000-000000000001'){
 return{session,persistent,options:{session:()=>session,persistent:()=>persistent,randomId:()=>id}};
}
test('認証情報はタブ保存だけに書き込み、同じタブの再読み込みでは同じキーで復元する',()=>{
 const s=setup();const a=createTabAuthStorage(project,s.options);a.storage.setItem(a.storageKey,'FAKE-TOKEN');
 const b=createTabAuthStorage(project,s.options);assert.equal(a.storageKey,b.storageKey);assert.equal(b.storage.getItem(b.storageKey),'FAKE-TOKEN');assert.equal(s.persistent.data.size,0);
});
test('閉じたタブの保存領域を破棄すると新しいタブは未ログインで、共有チャンネルのキーも異なる',()=>{
 const a=createTabAuthStorage(project,setup().options);a.storage.setItem(a.storageKey,'FAKE-TOKEN');
 const b=createTabAuthStorage(project,setup(store(),store(),'00000000-0000-4000-8000-000000000002').options);
 assert.notEqual(a.storageKey,b.storageKey);assert.equal(b.storage.getItem(b.storageKey),null);
});
test('旧版のこのプロジェクトの認証情報だけ撤去し、他プロジェクト・業務データを消さない',()=>{
 const s=setup();for(const k of ['sb-tab-test-auth-token','sb-tab-test-auth-token-code-verifier','sb-tab-test-auth-token-user','sb-other-auth-token','business-record'])s.persistent.setItem(k,'sentinel');
 createTabAuthStorage(project,s.options);
 assert.deepEqual([...s.persistent.data.keys()],['sb-other-auth-token','business-record']);
});
test('タブ保存や旧保存にアクセスできなくても永続保存へ切り替えない',()=>{
 const options={session:()=>{throw Error('blocked')},persistent:()=>{throw Error('blocked')},randomId:()=> '00000000-0000-4000-8000-000000000003'};
 const a=createTabAuthStorage(project,options);a.storage.setItem(a.storageKey,'FAKE-TOKEN');assert.equal(a.storage.getItem(a.storageKey),'FAKE-TOKEN');
 const b=createTabAuthStorage(project,options);assert.equal(b.storage.getItem(b.storageKey),null);
});
test('メインのクライアントは専用保存先を使い、URLから認証情報を取り込まない',()=>{
 const s=setup();let captured;
 load('src/lib/supabase.ts',{
  '@supabase/supabase-js':{createClient:(url,key,options)=>{captured={url,key,options};return{}}},
  './supabaseConfig':{supabaseUrl:project,supabasePublicKey:'public-test-key'},
  './tabAuthStorage':{createTabAuthStorage},
 },{window:{sessionStorage:s.session,localStorage:s.persistent},crypto:{randomUUID:s.options.randomId}});
 assert.equal(captured.options.auth.storage,s.session);assert.match(captured.options.auth.storageKey,/^connexy-tab-auth-/);
 assert.equal(captured.options.auth.detectSessionInUrl,false);assert.equal(captured.options.auth.persistSession,true);
});
test('実SDKでもタブ保存でログインを復元し、別タブには復元せず、ログアウトで削除する',async()=>{
 const s=setup();const authStore=createTabAuthStorage(project,s.options);
 const now=Math.floor(Date.now()/1000);const uid='00000000-0000-4000-8000-000000000001';
 const jwt=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:uid,iat:now,exp:now+3600,role:'authenticated',aud:'authenticated'})).toString('base64url'),'fake-signature'].join('.');
 const user={id:uid,aud:'authenticated',role:'authenticated',email:'fake@example.invalid',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
 const clients=[];
 const client=storage=>{const c=createClient(project,'public-test-key',{auth:{...storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async()=>new Response(JSON.stringify({access_token:jwt,refresh_token:'FAKE-REFRESH',expires_in:3600,token_type:'bearer',user}),{status:200,headers:{'content-type':'application/json'}})}});clients.push(c);return c;};
 try{
  const first=client(authStore);assert.equal((await first.auth.signInWithPassword({email:user.email,password:'fake-only-password'})).error,null);
  assert.ok(s.session.getItem(authStore.storageKey));assert.equal(s.persistent.data.size,0);
  const restored=client(createTabAuthStorage(project,s.options));assert.equal((await restored.auth.getSession()).data.session.user.id,uid);
  const fresh=client(createTabAuthStorage(project,setup(store(),store(),'00000000-0000-4000-8000-000000000002').options));assert.equal((await fresh.auth.getSession()).data.session,null);
  await restored.auth.signOut({scope:'local'});assert.equal(s.session.getItem(authStore.storageKey),null);
 }finally{for(const c of clients){await c.auth.stopAutoRefresh();c.auth.dispose();}}
});

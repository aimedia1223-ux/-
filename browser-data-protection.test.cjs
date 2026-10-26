const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,mocks={},extra={}){
 const source=fs.readFileSync(file,'utf8').replaceAll('import.meta.env','({})');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,require:n=>mocks[n]||{},...extra});return exports;
}
const {contentSecurityPolicy}=load('securityPolicy.ts',{}, {URL});
const directives=s=>new Map(s.split('; ').map(x=>{const [name,...sources]=x.split(' ');return[name,sources]}));
test('公開用ポリシーは自サイトと指定Supabaseのみ接続でき、地図/CDN/任意画像を許可しない',()=>{
 const d=directives(contentSecurityPolicy('https://project.supabase.co',false));
 assert.deepEqual(Array.from(d.get('connect-src')),["'self'",'https://project.supabase.co','wss://project.supabase.co']);
 for(const name of ['script-src','font-src'])assert.deepEqual(Array.from(d.get(name)),["'self'"]);
 assert.deepEqual(Array.from(d.get('img-src')),["'self'",'data:','blob:']);
 assert.deepEqual(Array.from(d.get('object-src')),["'none'"]);
 assert.deepEqual(Array.from(d.get('frame-src')),["'none'"]);
 assert.equal(contentSecurityPolicy('https://project.supabase.co',false).includes('unsafe-eval'),false);
});
test('開発用の例外はローカルの更新通信だけで、外部サービスは追加しない',()=>{
 const d=directives(contentSecurityPolicy('https://project.supabase.co',true));
 assert.deepEqual(Array.from(d.get('connect-src')),["'self'",'https://project.supabase.co','wss://project.supabase.co','ws://127.0.0.1:*','ws://localhost:*']);
 assert.deepEqual(Array.from(d.get('script-src')),["'self'","'unsafe-inline'"]);
});
test('URLのパス・認証情報・クエリ・危険な配信元指定を受け付けない',()=>{
 for(const url of ['http://project.supabase.co','https://user:pass@project.supabase.co','https://p.co/rest/v1','https://p.co/?secret=x','https://p.co/#x','https://p.co;evil.com'])assert.throws(()=>contentSecurityPolicy(url,false));
});
test('通常検索は承諾確認付き一覧だけを描画し、地図側のフックや送信処理を起動しない',()=>{
 const Catalog=()=>null;
 const ui=load('src/pages/SearchPage.tsx',{
  react:{useState:()=>{throw Error('legacy screen mounted')},useEffect:()=>{throw Error('legacy effect mounted')}},
  'react/jsx-runtime':{jsx:(type,props)=>({type,props})},
  'react-router-dom':{useNavigate:()=>()=>{}},
  '../lib/auth':{legacyDemoAuth:false},'../components/PublicJobCatalog':{PublicJobCatalog:Catalog},
 });
 assert.equal(ui.SearchPage().type,Catalog);
});
test('通常認証の検索状態はブラウザ保存を読み書きしない',()=>{
 let saved;let effect;
 const hook=load('src/hooks/useSessionState.ts',{
  react:{useState:init=>[init(),v=>{saved=v}],useEffect:fn=>{effect=fn}},'../lib/auth':{legacyDemoAuth:false},
 },{sessionStorage:{getItem:()=>{throw Error('must not read')},setItem:()=>{throw Error('must not save')}}});
 const [value,setValue]=hook.useSessionState('connexy_searchKeyword','');
 assert.equal(value,'');setValue('架空の検索');assert.equal(saved,'架空の検索');effect();
});
test('HTMLに外部スクリプト・フォント・地図CDNを残さず、フォントを同梱する',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.equal(/(?:src|href)="https?:\/\//.test(html),false);
 assert.match(html,/name="referrer" content="no-referrer"/);
 assert.equal(html.includes('unsafe-inline&#39;'),false);
 assert.equal(/<script(?![^>]*src=)[^>]*>\s*\S/.test(html),false);
 assert.ok(fs.statSync('public/fonts/MaterialSymbolsOutlined-Regular.ttf').size>10000);
});

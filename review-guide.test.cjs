const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
test('確認ガイドはログイン情報を持たず、用途・準備・制限・更新番号を案内する',()=>{
 const exports={};const code=ts.transpileModule(fs.readFileSync('src/components/ReviewNotice.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>n==='../lib/reviewBuild'?{reviewBuildLabel:'abcdef0'}:require(n)});
 const html=renderToStaticMarkup(React.createElement(exports.ReviewNotice));
 for(const text of ['機能・デザイン確認用','確認ガイド','架空データのみ','実際の案件・個人情報','追加認証が必要','更新番号：abcdef0'])assert.ok(html.includes(text));
 assert.equal(html.includes('<iframe'),false);assert.equal(html.includes('type="password"'),false);assert.equal(/<dialog[^>]*\sopen/.test(html),false);
});

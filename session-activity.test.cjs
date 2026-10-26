const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const fs = require('node:fs');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/sessionActivity.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText,{ exports: api });

function setup() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
  const user = { id: 'demoa', staffId: 'staff-c' };
  const events = new EventTarget(), visibilityEvents = new EventTarget();
  let time = 1_000_000, ticks, expires = 0, checks = 0;
  api.markSessionActive(user,storage,time);
  const options = { user,storage,events,visibilityEvents,now:()=>time,
    schedule: callback => { ticks=callback; return 1; },cancel:()=>{},
    onExpire:()=>expires++, onRevalidate:()=>checks++ };
  return { api, user, storage, values, events, options, start:()=>api.startSessionMonitor(options),
    advance: milliseconds => {time+=milliseconds;}, tick:()=>ticks(), get expires(){return expires;},get checks(){return checks;} };
}
test('無操作30分の境界で一度だけロックする',()=>{
  const s=setup(); const stop=s.start();
  s.advance(api.IDLE_TIMEOUT_MS-1);s.tick(); assert.equal(s.expires,0);
  s.advance(1);s.tick();s.tick();assert.equal(s.expires,1);assert.equal(api.isSessionLocked(s.user,s.storage),true);stop();
});
test('キーボード操作で延長するが、復帰・ポーリングでは無操作期限を延ばさない',()=>{
  const s=setup();const stop=s.start();
  s.advance(20*60_000);s.events.dispatchEvent(new Event('keydown'));
  s.advance(20*60_000);s.events.dispatchEvent(new Event('focus'));assert.equal(s.expires,0);
  s.advance(10*60_000);s.tick();assert.equal(s.expires,1);stop();
});
test('期限経過後の最初の操作で期限を復活させない',()=>{
  const s=setup();s.start();s.advance(api.IDLE_TIMEOUT_MS);
  s.events.dispatchEvent(new Event('pointerdown'));assert.equal(s.expires,1);
});
test('再読み込みでも保存した無操作時刻を引き継ぐ',()=>{
  const s=setup();const stop=s.start();stop();s.advance(api.IDLE_TIMEOUT_MS);
  s.start();assert.equal(s.expires,1);
});
test('同じ利用者の別タブでの操作を共有し、別利用者の操作で延長しない',()=>{
  const s=setup();s.start();s.advance(20*60_000);
  api.markSessionActive(s.user,s.storage,2_200_000);
  s.advance(20*60_000);s.tick();assert.equal(s.expires,0);
  api.markSessionActive({id:'demob',staffId:'staff-b'},s.storage,3_400_000);
  s.advance(10*60_000);s.tick();assert.equal(s.expires,1);
});
test('セッションの定期確認は無操作期限を延ばさない',()=>{
  const s=setup();s.start();s.advance(60_000);s.tick();assert.equal(s.checks,1);
  s.advance(api.IDLE_TIMEOUT_MS-60_000);s.tick();assert.equal(s.expires,1);
});
test('正しい再ログインの活動記録でロックを解除できる',()=>{
  const s=setup();s.start();s.advance(api.IDLE_TIMEOUT_MS);s.tick();
  api.markSessionActive(s.user,s.storage,3_000_000);assert.equal(api.isSessionLocked(s.user,s.storage),false);
});
test('活動記録の保存が使えない場合も画面をロックする',()=>{
  const s=setup();s.options.storage={getItem:()=>{throw Error('blocked');},setItem:()=>{},removeItem:()=>{}};
  s.start();assert.equal(s.expires,1);
});

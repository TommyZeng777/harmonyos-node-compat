import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCEPTED_DIFFERENCES,PLATFORM_CHECKS,checkPlatform} from '../src/conformance.mjs';

// Every expected answer is Node's: the device check reports a difference from Node,
// never a difference from a guess.
test('every platform check matches Node',()=>{
 assert.ok(PLATFORM_CHECKS.length>100);
 assert.deepEqual(checkPlatform(),[]);
});

test('a platform that answers differently is reported, including a throw',()=>{
 const checks=[['encode:empty',()=>undefined,[]],['url:invalid',()=>'ok',{throws:'TypeError'}],['same',()=>1,1]];
 assert.deepEqual(checkPlatform(checks).map(item=>[item.id,item.actual]),[['encode:empty',{undefined:true}],['url:invalid','ok']]);
});

test('every accepted device difference names a real check and a reason',()=>{
 const ids=new Set(PLATFORM_CHECKS.map(([id])=>id));
 for(const [id,reason] of Object.entries(ACCEPTED_DIFFERENCES)){assert.ok(ids.has(id),id);assert.ok(reason.length>10,id)}
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {patchPiAiSurrogates} from '../src/sdk-patches/pi-ai-surrogates.mjs';

const pinned=String.raw`  function sanitizeSurrogates(text2) {
    return text2.replace(new RegExp("[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]", "g"), "");
  }`;

test('patched sanitizer retains valid long text and removes only unpaired surrogates',()=>{
 const transformed=patchPiAiSurrogates(pinned);
 const sanitize=runInNewContext(`${transformed}\nsanitizeSurrogates`);
 const cases=['plain text', 'a'.repeat(4000000), 'a\uD83D\uDE00b',
  'a\uD800b', 'a\uDC00b', '\uD800\uD800\uDC00\uDC00'];
 const expected=text=>text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'');
 for(const value of cases)assert.equal(sanitize(value),expected(value));
});

test('patched sanitizer fails closed when the pinned upstream body changes',()=>{
 assert.throws(()=>patchPiAiSurrogates('function sanitizeSurrogates() {}'),/shape changed/);
 assert.throws(()=>patchPiAiSurrogates(pinned+'\n'+pinned),/shape changed/);
});

test('patched sanitizer follows the bundler renaming its parameter but not a changed body',()=>{
 const renamed=pinned.replaceAll('text2','text3');
 const transformed=patchPiAiSurrogates(renamed);
 assert.match(transformed,/function sanitizeSurrogates\(text3\)/);
 assert.equal(runInNewContext(`${transformed}\nsanitizeSurrogates`)('a\uD800b'),'ab');
 assert.equal(patchPiAiSurrogates(pinned),patchPiAiSurrogates(pinned.replaceAll('text2','text9')).replaceAll('text9','text2'));
 assert.throws(()=>patchPiAiSurrogates(renamed.replace('"g"','"gu"')),/shape changed/);
 assert.throws(()=>patchPiAiSurrogates(renamed.replace('return text3.replace','return other.replace')),/shape changed/);
});

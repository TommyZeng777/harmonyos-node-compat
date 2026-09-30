// Runtime self-check of what Node-targeted code expects from the platform.
// The ThreadWorker provides some of these itself (ArkTS TextEncoder, URL, Intl,
// newer built-ins) and this package provides the rest; presence is not proof of
// Node behavior (ArkTS TextEncoder.encode('') returns undefined). Each check carries
// Node's answer; test/conformance.test.mjs keeps this list passing on Node, and on
// the device checkPlatform() returns every check that answers differently.
const bytes = value => Array.from(value ?? []);
const typeOf = path => { let value = globalThis; for (const key of path.split('.')) value = value?.[key]; return typeof value; };
const PRESENT = [
  'Array.prototype.at', 'Array.prototype.flat', 'Array.prototype.flatMap', 'Array.prototype.findLast', 'Array.prototype.findLastIndex',
  'Array.prototype.toReversed', 'Array.prototype.toSorted', 'Array.prototype.toSpliced', 'Array.prototype.with',
  'Object.hasOwn', 'Object.fromEntries', 'Object.groupBy', 'Map.groupBy',
  'Set.prototype.union', 'Set.prototype.intersection', 'Set.prototype.difference', 'Set.prototype.isSubsetOf',
  'String.prototype.replaceAll', 'String.prototype.at', 'String.prototype.matchAll', 'String.prototype.isWellFormed', 'String.prototype.toWellFormed',
  'Promise.any', 'Promise.allSettled', 'Promise.withResolvers', 'AggregateError', 'WeakRef', 'FinalizationRegistry', 'queueMicrotask',
  'structuredClone', 'EventTarget', 'Event', 'CustomEvent', 'DOMException', 'performance.now', 'Error.captureStackTrace',
  'URL.canParse', 'crypto.subtle', 'crypto.randomUUID', 'crypto.getRandomValues', 'Intl.Segmenter', 'Intl.Collator',
  'Intl.DateTimeFormat', 'Intl.NumberFormat', 'TextEncoder', 'TextDecoder', 'TextDecoderStream', 'atob', 'btoa',
  'AbortController', 'AbortSignal.any', 'AbortSignal.timeout', 'Headers', 'Request', 'Response', 'ReadableStream',
].map(path => [`present:${path}`, () => typeOf(path) !== 'undefined', true]);

export const PLATFORM_CHECKS = [
  ...PRESENT,
  ['encode:empty', () => bytes(new TextEncoder().encode('')), []],
  ['encode:cjk', () => bytes(new TextEncoder().encode('中')), [228, 184, 173]],
  ['encode:lone-surrogate', () => bytes(new TextEncoder().encode('\uD800')), [239, 191, 189]],
  ['decode:empty', () => new TextDecoder().decode(new Uint8Array()), ''],
  ['decode:invalid', () => new TextDecoder().decode(new Uint8Array([255, 97])), '�a'],
  ['decode:bom', () => new TextDecoder().decode(new Uint8Array([239, 187, 191, 97])), 'a'],
  ['decode:stream-split', () => { const d = new TextDecoder(); return d.decode(new Uint8Array([228, 184]), { stream: true }) + d.decode(new Uint8Array([173])); }, '中'],
  ['url:encode-path', () => new URL('https://a.test/a b?x=1#y').href, 'https://a.test/a%20b?x=1#y'],
  ['url:relative', () => new URL('../c', 'https://a.test/a/b').href, 'https://a.test/c'],
  ['url:default-port', () => new URL('https://a.test:443/').href, 'https://a.test/'],
  ['url:idn', () => new URL('https://例子.测试/').hostname, 'xn--fsqu00a.xn--0zwm56d'],
  ['url:userinfo', () => new URL('https://u:p@a.test/').username, 'u'],
  ['url:invalid', () => new URL('not a url').href, { throws: 'TypeError' }],
  ['url:search-plus', () => new URL('https://a.test/?q=a+b%20c').searchParams.get('q'), 'a b c'],
  ['url:search-set', () => { const u = new URL('https://a.test/'); u.searchParams.set('k', 'a b&c'); return u.href; }, 'https://a.test/?k=a+b%26c'],
  ['url:can-parse', () => URL.canParse('https://a.test') && !URL.canParse('nope'), true],
  ['url:valid-forms', () => ['http://localhost:8080/p?q=1', 'https://[::1]:3000/x', 'file:///tmp/a%20b', 'data:text/plain,hi', 'https://a.test/?a[0]=1&b=%E4%B8%AD', 'https://api.example.com/v1', 'wss://example.com/v1/stream'].map(input => new URL(input).href),
    ['http://localhost:8080/p?q=1', 'https://[::1]:3000/x', 'file:///tmp/a%20b', 'data:text/plain,hi', 'https://a.test/?a[0]=1&b=%E4%B8%AD', 'https://api.example.com/v1', 'wss://example.com/v1/stream']],
  ['url:parse', () => [URL.parse('nope'), URL.parse('/x', 'https://a.test/y')?.href], [null, 'https://a.test/x']],
  ['url:instance', () => new URL('https://a.test/p?x=1').searchParams.get('x') === '1' && new URL('https://a.test') instanceof URL, true],
  ['crypto:subtle-sha256', () => typeof crypto.subtle.digest, 'function'],
  ['microtask:order', () => typeof queueMicrotask, 'function'],
  // zone.js runs each microtask as callback.apply(null, null) and wraps every writable
  // global it finds; a wrapped queueMicrotask stalls streamed responses on ArkTS.
  // Both are exercised here, not just checked for presence.
  ['function:apply-null-args', () => (function () { return arguments.length; }).apply(null, null), 0],
  ['microtask:not-zone-wrapped', () => typeof Zone === 'undefined' || typeof queueMicrotask !== 'function'
    || !queueMicrotask[Zone.__symbol__('OriginalDelegate')], true],
  ['search-params:repeat', () => new URLSearchParams('a=1&a=2&b=%20+').getAll('a').concat(new URLSearchParams('a=1&b=%20+').get('b')), ['1', '2', '  ']],
  ['base64:atob', () => atob('5Lit'), 'ä¸­'],
  ['base64:atob-invalid', () => atob('*'), { throws: 'InvalidCharacterError' }],
  ['base64:btoa-latin1', () => btoa('é'), '6Q=='],
  ['base64:btoa-wide', () => btoa('中'), { throws: 'InvalidCharacterError' }],
  ['crypto:uuid', () => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(crypto.randomUUID()), true],
  ['crypto:random-values', () => { const a = new Uint8Array(4); return crypto.getRandomValues(a) === a; }, true],
  ['clone:error', () => { const e = structuredClone(new TypeError('m', { cause: 1 })); return [e instanceof TypeError, e.message, e.cause]; }, [true, 'm', 1]],
  ['clone:symbol-key', () => Object.keys(structuredClone({ [Symbol('s')]: 1, a: 2 })), ['a']],
  ['abort:reason', () => { const c = new AbortController(); c.abort(); return [c.signal.reason?.name, c.signal.reason?.message]; }, ['AbortError', 'This operation was aborted']],
  ['headers:trim', () => new Headers([['X-A', ' v\n']]).get('x-a'), 'v'],
  ['response:clone', () => typeof new Response('x').clone, 'function'],
  ['compare:basic', () => ['b', 'a', 'B'].sort((x, y) => x.localeCompare(y)), ['a', 'b', 'B']],
  ['compare:base', () => 'a'.localeCompare('A', undefined, { sensitivity: 'base' }), 0],
  ['compare:accent', () => 'ä'.localeCompare('z', 'de'), -1],
  ['compare:numeric', () => ['10', '9'].sort(new Intl.Collator(undefined, { numeric: true }).compare), ['9', '10']],
  ['normalize:nfd', () => 'é'.normalize('NFD').length, 2],
  ['normalize:nfkc', () => 'ﬁ'.normalize('NFKC'), 'fi'],
  ['case:turkish', () => 'i'.toLocaleUpperCase('tr'), 'İ'],
  ['segment:grapheme', () => [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment('👨‍👩‍👧中a')].length, 3],
  ['segment:word', () => [...new Intl.Segmenter('en', { granularity: 'word' }).segment('hi there')].filter(s => s.isWordLike).length, 2],
  ['number:format', () => new Intl.NumberFormat('en-US').format(1234.5), '1,234.5'],
  ['number:locale', () => (1234.5).toLocaleString('en-US'), '1,234.5'],
  ['date:format', () => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(0), '01/01/1970'],
  ['date:timezone', () => typeof new Intl.DateTimeFormat().resolvedOptions().timeZone, 'string'],
  ['date:parse-iso', () => Date.parse('2026-01-01T00:00:00Z'), 1767225600000],
  ['date:parse-date-only', () => Date.parse('2026-01-01'), 1767225600000],
  ['date:iso', () => new Date(0).toISOString(), '1970-01-01T00:00:00.000Z'],
  ['regexp:lookbehind', () => [/(?<=a)b/.test('ab'), /(?<!a)b/.test('ab')], [true, false]],
  ['regexp:unicode-property', () => /\p{L}+/u.exec('中a1')[0], '中a'],
  ['regexp:named-group', () => /(?<y>\d+)/.exec('x12').groups.y, '12'],
  ['regexp:indices', () => /a/d.exec('ba').indices[0], [1, 2]],
  ['array:to-sorted', () => [3, 1, 2].toSorted(), [1, 2, 3]],
  ['array:find-last', () => [1, 2, 3].findLast(x => x < 3), 2],
  ['array:stable-sort', () => [{ k: 1, i: 0 }, { k: 0, i: 1 }, { k: 1, i: 2 }].sort((a, b) => a.k - b.k).map(x => x.i), [1, 0, 2]],
  ['set:union', () => new Set([1, 2]).union(new Set([2, 3])).size, 3],
  ['object:group-by', () => Object.groupBy([1, 2, 3], x => x % 2 ? 'odd' : 'even'), { odd: [1, 3], even: [2] }],
  ['json:lone-surrogate', () => JSON.stringify('\uD800'), '"\\ud800"'],
  ['error:cause', () => new Error('a', { cause: 1 }).cause, 1],
  ['string:well-formed', () => ['a\uD800'.isWellFormed(), 'a\uD800'.toWellFormed()], [false, 'a�']],
  ['event:dispatch', () => { const t = new EventTarget(); let seen = null; t.addEventListener('x', e => { seen = e.detail; }); t.dispatchEvent(new CustomEvent('x', { detail: 5 })); return seen; }, 5],
];

// Differences measured on HarmonyOS 7.0.0.106/109 that this package deliberately does
// not fill. Callers can log them instead of treating them as errors; any other
// difference, e.g. after a system update, should be reported. Fill one yourself if
// your code depends on it.
export const ACCEPTED_DIFFERENCES = Object.freeze({
  'present:EventTarget': 'not provided; bring an EventTarget implementation if needed',
  'present:Event': 'not provided; bring an EventTarget implementation if needed',
  'present:CustomEvent': 'not provided; bring an EventTarget implementation if needed',
  'event:dispatch': 'not provided; bring an EventTarget implementation if needed',
  'url:idn': 'ArkTS URL does not convert IDN hostnames to punycode',
  'compare:numeric': 'ArkTS ignores the Intl.Collator numeric option',
  // ArkTS throws TypeError where Node accepts a null argument list. zone.js calls
  // wrapped microtasks this way; microtask:not-zone-wrapped guards the consequence.
  'function:apply-null-args': 'ArkTS rejects a null argument list; queueMicrotask is kept out of zone.js',
});

function canonical(value) {
  if (value === undefined) return { undefined: true };
  return JSON.parse(JSON.stringify(value));
}

// Returns only the checks whose answer differs from Node's.
export function checkPlatform(checks = PLATFORM_CHECKS) {
  const mismatches = [];
  for (const [id, run, expected] of checks) {
    let actual;
    try { actual = canonical(run()); } catch (error) { actual = { throws: error?.name || String(error) }; }
    if (JSON.stringify(actual) !== JSON.stringify(canonical(expected))) mismatches.push({ id, expected, actual });
  }
  return mismatches;
}

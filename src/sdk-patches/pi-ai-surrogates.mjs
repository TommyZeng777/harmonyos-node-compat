// Build-time source patch for a bundle containing the `@earendil-works/pi-ai`
// sanitizeSurrogates helper. It always runs String.replace; on ArkTS that can
// copy a very large, already valid UTF-16 string into the shared heap.
// Keep its exact invalid-surrogate removal and avoid the copy when no repair
// is needed. Fail the build if the pinned upstream shape changes.
// The body must match exactly; only the parameter's name may differ, because
// the bundler renames it (text2, text3, ...) whenever another module in the
// bundle declares the same identifier.
const invalidSurrogates=String.raw`"[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]"`;
const shape=new RegExp(String.raw`  function sanitizeSurrogates\((\w+)\) \{\n    return \1\.replace\(new RegExp\(`
  +invalidSurrogates.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+String.raw`, "g"\), ""\);\n  \}`,'g');

export function patchPiAiSurrogates(source){
 const matches=[...source.matchAll(shape)];
 if(matches.length!==1)throw Error('Pinned pi-ai surrogate sanitizer shape changed');
 const [original,name]=matches[0];
 const pattern=`new RegExp(${invalidSurrogates}`;
 const optimized=`  function sanitizeSurrogates(${name}) {
    if (!${pattern}).test(${name})) return ${name};
    return ${name}.replace(${pattern}, "g"), "");
  }`;
 return source.slice(0,matches[0].index)+optimized+source.slice(matches[0].index+original.length);
}

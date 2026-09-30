// Build-time source patch for the `openai` npm SDK.
// ArkTS URLSearchParams.forEach works, but its iterator cannot be consumed by
// Object.fromEntries inside a ThreadWorker. The OpenAI SDK uses that exact
// expression while constructing a request URL. The patch is narrow, keeps the
// duplicate-key last-write behavior, and throws if the SDK source changes.
export function patchOpenAIUrlQuery(source) {
  const marker = 'const pathQuery = Object.fromEntries(url.searchParams);';
  if (source.split(marker).length !== 2) throw Error('OpenAI URL query source changed');
  return source.replace(marker, `const pathQuery = {};
        url.searchParams.forEach((value, key) => { pathQuery[key] = value; });`);
}

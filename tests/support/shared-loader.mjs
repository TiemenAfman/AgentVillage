// Browser import-map equivalent for geometry tests running under Node.
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('shared/')) {
    return nextResolve(new URL(`../../${specifier}`, import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}

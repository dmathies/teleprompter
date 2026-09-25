export async function resolve(specifier, context, defaultResolve) {
  if (specifier.endsWith('.scss') || specifier.endsWith('.css')) {
    return {
      format: 'module',
      shortCircuit: true,
      url: `data:text/javascript,export default '';`
    };
  }
  if (specifier.startsWith('~icons/')) {
    return {
      format: 'module',
      shortCircuit: true,
      url: `data:text/javascript,export default '<svg class="mock-icon"></svg>';`
    };
  }
  return defaultResolve(specifier, context, defaultResolve);
}

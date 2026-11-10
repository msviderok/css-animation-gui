import { parse, walk, generate } from 'css-tree';

export function validateCss(source, supports = () => true) {
  const stack = []; let quote = '', comment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (comment) { if (c === '*' && next === '/') { comment = false; i++; } continue; }
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ('({['.includes(c)) stack.push(c);
    if (')}]'.includes(c) && stack.pop() !== { ')': '(', '}': '{', ']': '[' }[c]) return { valid: false, error: 'Unmatched bracket' };
  }
  if (stack.length || quote || comment) return { valid: false, error: 'Finish the open rule, value, string, or comment' };
  try {
    const errors = [];
    const ast = parse(source, { parseCustomProperty: true, onParseError(error) { errors.push(error); } });
    let recovered = false;
    walk(ast, function(node) {
      // CSS Tree recovers type-selector-first CSS nesting as Raw. Validate that
      // nested rule independently instead of rejecting valid browser CSS.
      if (node.type === 'Raw' && errors.length) {
        if (!node.value.includes('{') || node.value === source) throw new Error(errors[0]?.message || 'Invalid CSS');
        const nested = validateCss(node.value, supports);
        if (!nested.valid) throw new Error(nested.error);
        recovered = true;
      }
      if (node.type === 'Declaration' && this.rule && !node.property.startsWith('--')) {
        const value = generate(node.value);
        if (!supports(node.property, value)) throw new Error(`Invalid ${node.property}: ${value}`);
      }
    });
    if (errors.length && !recovered) throw errors[0];
    return { valid: true };
  } catch (error) { return { valid: false, error: error.message }; }
}

export function expandPlan(value, bindings) {
  if (typeof value === 'string') {
    const exact = /^\{([^{}]+)\}$/.exec(value);
    if (exact && bindings[exact[1]]) return bindings[exact[1]].type === 'session-private-path' && bindings[exact[1]].materialization ? value : bindings[exact[1]].value ?? bindings[exact[1]].handleRef;
    return value.replace(/\{([^{}]+)\}/g, (token, name) => {
      const binding = bindings[name];
      if (!binding) throw new Error(`Unbound plan field: ${name}`);
      if (binding.type === 'session-private-path') return token;
      return String(binding.value ?? binding.handleRef);
    });
  }
  if (Array.isArray(value)) return value.map(item => expandPlan(item, bindings));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandPlan(item, bindings)]));
  return value;
}


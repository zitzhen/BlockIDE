type Child = Node | string | number | undefined | null | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on'))
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === 'class') node.className = String(value);
    else if (['value', 'checked', 'disabled', 'selected'].includes(key))
      (node as unknown as Record<string, unknown>)[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children)
    if (child !== undefined && child !== null && child !== false)
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

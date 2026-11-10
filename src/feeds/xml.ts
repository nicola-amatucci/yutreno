/**
 * Minimal XML reader for the imports (NeTEx, railML): elements with local names (namespace prefixes dropped),
 * attributes and text. No DTD, no validation; comments, processing instructions and CDATA are handled.
 * Pure TypeScript, so it runs in the browser and in Node without dependencies.
 */
export interface XmlNode {
  /** Local name, without the namespace prefix */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside the element, trimmed */
  text: string;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
const local = (n: string): string => n.slice(n.indexOf(':') + 1);

/** Parses a document and returns its root element */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0, text = '';
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    text += src.slice(i, lt);
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); text += src.slice(lt + 9, e).replace(/&/g, '&amp;').replace(/</g, '&lt;'); i = e + 3; continue; }
    if (src.startsWith('<?', lt)) { i = src.indexOf('?>', lt) + 2; continue; }
    if (src.startsWith('<!', lt)) { i = src.indexOf('>', lt) + 1; continue; }
    if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt), name = local(src.slice(lt + 2, gt).trim());
      const n = stack.pop() as XmlNode;
      if (!n || n.name !== name) throw new Error(`XML: </${name}> does not close <${n?.name}>`);
      n.text = decode(n.text + text).trim();
      text = '';
      i = gt + 1;
      continue;
    }
    // the text before a child element belongs to the parent
    top().text += text; text = '';
    let j = lt + 1;
    while (j < src.length && !/[\s/>]/.test(src[j])) j++;
    const node: XmlNode = { name: local(src.slice(lt + 1, j)), attrs: {}, children: [], text: '' };
    const re = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?)>/y;
    re.lastIndex = j;
    let closed = false;
    for (;;) {
      const m = re.exec(src);
      if (!m) throw new Error(`XML: malformed tag <${node.name}> at ${lt}`);
      if (m[1]) { const k = m[1]; if (!k.startsWith('xmlns')) node.attrs[local(k)] = decode(m[3] ?? m[4]); continue; }
      closed = m[5] === '/';
      i = re.lastIndex;
      break;
    }
    top().children.push(node);
    if (!closed) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`XML: <${top().name}> not closed`);
  const r = root.children[0];
  if (!r) throw new Error('XML: no root element');
  return r;
}

/** Children with a given local name */
export const kids = (n: XmlNode | undefined, name: string): XmlNode[] => n ? n.children.filter(c => c.name === name) : [];
/** First child with a given local name */
export const kid = (n: XmlNode | undefined, name: string): XmlNode | undefined => n?.children.find(c => c.name === name);
/** Text of the first child with a given name, or '' */
export const kidText = (n: XmlNode | undefined, name: string): string => kid(n, name)?.text ?? '';
/** All descendants with a given local name, in document order */
export function all(n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) { if (c.name === name) out.push(c); all(c, name, out); }
  return out;
}

/**
 * Indents a document written on one line, for reading: elements with only text stay on one line. Meant for documents
 * without mixed content, such as those of the feeds.
 */
export function formatXml(src: string, indent = '  '): string {
  const out: string[] = [];
  let depth = 0;
  const re = /(<\?[^>]*\?>)|(<!--[\s\S]*?-->)|(<\/[^>]+>)|(<[^>]+\/>)|(<[^>]+>)([^<]*)(<\/[^>]+>)?|([^<]+)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const pad = indent.repeat(depth);
    if (m[1] || m[2]) out.push(pad + (m[1] ?? m[2]));
    else if (m[3]) { depth = Math.max(0, depth - 1); out.push(indent.repeat(depth) + m[3]); }
    else if (m[4]) out.push(pad + m[4]);
    else if (m[5]) {
      if (m[7]) out.push(pad + m[5] + m[6] + m[7]);
      else { out.push(pad + m[5]); depth++; if (m[6].trim()) out.push(indent.repeat(depth) + m[6].trim()); }
    } else if (m[8] && m[8].trim()) out.push(pad + m[8].trim());
  }
  return out.join('\n') + '\n';
}

/**
 * Sanitise the small rich-text subset supported by resume fields.
 *
 * This deliberately does not depend on a browser DOM implementation. Resume
 * templates are rendered on the Next.js server for both the preview and the
 * PDF print route; importing `isomorphic-dompurify` there made JSDOM try to
 * load a Webpack build-time stylesheet and caused PDF downloads to fail.
 *
 * The editor only supports these four formatting tags. Everything else is
 * rendered as text, and links are limited to safe, explicit protocols.
 */

const ALLOWED_TAGS = new Set(['strong', 'em', 'u', 'a']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|svg|math|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const HTML_TAG = /<\/?[^>]*>/g;

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

function decodeProtocol(value: string): string {
  return value
    .replace(/&#(x[\da-f]+|\d+);?/gi, (_, code: string) => {
      const numeric = code.toLowerCase().startsWith('x')
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : '';
    })
    .replace(/\s+/g, '')
    .toLowerCase();
}

function safeHref(attributes: string): string | null {
  const match = attributes.match(
    /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
  );
  const href = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!href) return null;

  const protocol = decodeProtocol(href);
  // Resume links may be web links, e-mail links, in-document anchors, or a
  // relative path. Do not permit executable/data URLs or unknown schemes.
  if (
    !(
      protocol.startsWith('https://') ||
      protocol.startsWith('http://') ||
      protocol.startsWith('mailto:') ||
      protocol.startsWith('#') ||
      protocol.startsWith('/') ||
      protocol.startsWith('./') ||
      protocol.startsWith('../')
    )
  ) {
    return null;
  }
  return href;
}

/**
 * Sanitises HTML content using a strict, server-safe whitelist.
 *
 * @param dirty - The unsanitised HTML string
 * @returns Sanitised HTML string safe for `dangerouslySetInnerHTML`
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';

  const withoutDangerousContent = dirty.replace(DROP_WITH_CONTENT, '').replace(HTML_COMMENT, '');

  return withoutDangerousContent.replace(HTML_TAG, (tag) => {
    const closing = tag.match(/^<\s*\/\s*([a-z0-9-]+)\s*>$/i);
    if (closing) {
      const name = closing[1].toLowerCase();
      return ALLOWED_TAGS.has(name) ? `</${name}>` : '';
    }

    const opening = tag.match(/^<\s*([a-z0-9-]+)\b([^>]*)>$/i);
    if (!opening) return '';

    const name = opening[1].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (name !== 'a') return `<${name}>`;

    const href = safeHref(opening[2]);
    if (!href) return '<a>';
    return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">`;
  });
}

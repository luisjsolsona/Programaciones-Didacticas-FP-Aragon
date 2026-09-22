// =============================================================
// backend/sanitize.js — Saneado de HTML guardado por los docentes
//
// Los campos de texto enriquecido se guardan como HTML y se muestran
// a otros docentes del mismo ciclo. Aquí se eliminan scripts, eventos
// (onclick, onerror…), iframes y URLs javascript:, conservando el
// formato habitual (negritas, listas, títulos, colores, enlaces…).
//
// Solo se procesan cadenas que contienen etiquetas; el texto plano
// (p. ej. "< 5 horas") se deja intacto.
// =============================================================
const sanitizeHtml = require('sanitize-html');

const OPTIONS = {
  allowedTags: [
    'p', 'div', 'span', 'br', 'hr', 'blockquote', 'pre', 'code',
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'small', 'mark', 'font',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'a', 'input',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  ],
  allowedAttributes: {
    '*':   ['style', 'dir', 'class', 'role', 'aria-level', 'align'],
    a:     ['href', 'target', 'rel'],
    font:  ['color', 'face', 'size'],
    input: ['type', 'checked', 'disabled'],
    td:    ['colspan', 'rowspan'],
    th:    ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    // Solo casillas de verificación (listas de comprobación)
    input: (tag, attribs) => attribs.type === 'checkbox'
      ? { tagName: 'input', attribs }
      : { tagName: 'span', attribs: {} },
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
  // Descarta también el contenido de estas etiquetas
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math'],
};

const HAS_TAG = /<\s*[a-zA-Z!\/?]/;

function cleanString(str) {
  return HAS_TAG.test(str) ? sanitizeHtml(str, OPTIONS) : str;
}

// Recorre objetos/arrays y sanea todas las cadenas
function sanitizeDeep(value) {
  if (typeof value === 'string') return cleanString(value);
  if (Array.isArray(value))      return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out;
  }
  return value;
}

module.exports = { sanitizeDeep, cleanString };

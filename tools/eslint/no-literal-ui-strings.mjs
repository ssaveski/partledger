// User-facing text must come from translation keys (R36), so literal text in
// JSX and in text-bearing attributes is refused.
const textAttributes = new Set([
  'alt',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
]);

function hasLetters(value) {
  return /\p{L}/u.test(value);
}

/** @type {import('eslint').Rule.RuleModule} */
export const noLiteralUiStrings = {
  meta: {
    type: 'problem',
    docs: { description: 'Refuse literal user-facing strings; use translation keys.' },
    schema: [],
    messages: {
      literalText: 'Literal UI text "{{text}}"; render a translation key instead.',
    },
  },
  create(context) {
    function report(node, text) {
      context.report({ node, messageId: 'literalText', data: { text: text.trim().slice(0, 40) } });
    }
    return {
      JSXText(node) {
        if (hasLetters(node.value)) {
          report(node, node.value);
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !textAttributes.has(node.name.name) || node.value === null) {
          return;
        }
        if (node.value.type === 'Literal' && typeof node.value.value === 'string' && hasLetters(node.value.value)) {
          report(node.value, node.value.value);
        }
        if (
          node.value.type === 'JSXExpressionContainer' &&
          node.value.expression.type === 'Literal' &&
          typeof node.value.expression.value === 'string' &&
          hasLetters(node.value.expression.value)
        ) {
          report(node.value, node.value.expression.value);
        }
      },
      'JSXExpressionContainer > Literal'(node) {
        if (node.parent.parent?.type !== 'JSXAttribute' && typeof node.value === 'string' && hasLetters(node.value)) {
          report(node, node.value);
        }
      },
      'JSXExpressionContainer > TemplateLiteral'(node) {
        if (
          node.parent.parent?.type !== 'JSXAttribute' &&
          node.quasis.some((quasi) => hasLetters(quasi.value.cooked ?? ''))
        ) {
          report(node, node.quasis.map((quasi) => quasi.value.cooked ?? '').join('…'));
        }
      },
    };
  },
};

export const partledgerPlugin = {
  meta: { name: 'partledger' },
  rules: { 'no-literal-ui-strings': noLiteralUiStrings },
};

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

// `value` is shown as text only on button-like inputs; elsewhere it is data.
const buttonLikeInputTypes = new Set(['button', 'submit', 'reset']);

function hasLetters(value) {
  return /\p{L}/u.test(value);
}

/** Every literal text an expression can evaluate to, through conditionals and logical operators. */
function literalTexts(expression) {
  switch (expression.type) {
    case 'Literal':
      return typeof expression.value === 'string' && hasLetters(expression.value) ? [expression.value] : [];
    case 'TemplateLiteral': {
      const text = expression.quasis.map((quasi) => quasi.value.cooked ?? '').join('…');
      return hasLetters(text) ? [text] : [];
    }
    case 'ConditionalExpression':
      return [...literalTexts(expression.consequent), ...literalTexts(expression.alternate)];
    case 'LogicalExpression':
      return [...literalTexts(expression.left), ...literalTexts(expression.right)];
    default:
      return [];
  }
}

function attributeValueTexts(value) {
  if (value.type === 'Literal') {
    return literalTexts(value);
  }
  if (value.type === 'JSXExpressionContainer') {
    return literalTexts(value.expression);
  }
  return [];
}

function isButtonLikeInput(attribute) {
  const element = attribute.parent;
  if (element.name.type !== 'JSXIdentifier' || element.name.name !== 'input') {
    return false;
  }
  return element.attributes.some(
    (other) =>
      other.type === 'JSXAttribute' &&
      other.name.name === 'type' &&
      other.value?.type === 'Literal' &&
      buttonLikeInputTypes.has(String(other.value.value)),
  );
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
    function report(node, texts) {
      for (const text of texts) {
        context.report({ node, messageId: 'literalText', data: { text: text.trim().slice(0, 40) } });
      }
    }
    return {
      JSXText(node) {
        if (hasLetters(node.value)) {
          report(node, [node.value]);
        }
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.value === null) {
          return;
        }
        const name = node.name.name;
        if (textAttributes.has(name) || (name === 'value' && isButtonLikeInput(node))) {
          report(node.value, attributeValueTexts(node.value));
        }
      },
      JSXExpressionContainer(node) {
        if (node.parent.type === 'JSXElement' || node.parent.type === 'JSXFragment') {
          report(node, literalTexts(node.expression));
        }
      },
    };
  },
};

export const partledgerPlugin = {
  meta: { name: 'partledger' },
  rules: { 'no-literal-ui-strings': noLiteralUiStrings },
};

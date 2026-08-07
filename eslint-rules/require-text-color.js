/**
 * Require every <Text> to receive an explicit color.
 *
 * React Native defaults uncolored Text to black, so a screen that only ever got
 * checked in light mode renders black-on-black in dark mode. That is exactly how
 * the Reuse & repeat screen shipped invisible, and the same bug was sitting in
 * account, wallet, and create/ai.
 *
 * The rule is deliberately lenient: it only reports when it can prove no color
 * is applied. Anything it cannot resolve (a function call, an imported style) is
 * assumed to be fine, so this stays adoptable rather than noisy.
 *
 * Not flagged:
 *  - a <Text> nested inside another <Text> — RN inherits color from the parent
 *  - a `color` prop
 *  - a style that resolves to an object carrying `color`, through local consts,
 *    StyleSheet.create entries, arrays, and spreads
 */

const MAX_DEPTH = 6;

function isTextName(nameNode) {
  if (!nameNode) return false;
  if (nameNode.type === "JSXIdentifier") return nameNode.name === "Text";
  // Animated.Text, Reanimated.Text, …
  if (nameNode.type === "JSXMemberExpression") return nameNode.property?.name === "Text";
  return false;
}

/**
 * True when this Text is inside another Text and therefore inherits its color.
 * `node` is the JSXOpeningElement, whose parent is its own JSXElement — start
 * above that, or every Text matches itself.
 */
function hasTextAncestor(node) {
  const self = node.parent; // the JSXElement this opening tag belongs to
  for (let cur = self?.parent; cur; cur = cur.parent) {
    if (cur.type === "JSXElement" && isTextName(cur.openingElement?.name)) return true;
  }
  return false;
}

function propertyIsColor(prop) {
  if (prop.type !== "Property") return false;
  const key = prop.key;
  if (prop.computed) return true; // computed key — can't prove absence, stay lenient
  return (key.type === "Identifier" && key.name === "color") || (key.type === "Literal" && key.value === "color");
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require an explicit color on <Text> so it stays legible in dark mode",
    },
    schema: [],
    messages: {
      missingColor:
        "<Text> has no explicit color. React Native defaults to black, which is invisible in dark mode — set `color: theme.text` (or `theme.mutedText`) rather than relying on `opacity`.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** Find the initializer for an identifier, following the scope chain. */
    function resolveIdentifier(node) {
      let scope = sourceCode.getScope(node);
      while (scope) {
        const variable = scope.variables.find((v) => v.name === node.name);
        if (variable) {
          const def = variable.defs[variable.defs.length - 1];
          return def?.node?.type === "VariableDeclarator" ? def.node.init : null;
        }
        scope = scope.upper;
      }
      return null;
    }

    /** Unwrap StyleSheet.create({...}) down to the object literal. */
    function unwrap(node) {
      if (!node) return null;
      if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return unwrap(node.expression);
      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.property?.name === "create" &&
        node.arguments.length === 1
      ) {
        return unwrap(node.arguments[0]);
      }
      return node;
    }

    /**
     * Does this style expression apply a color?
     * Returns true when it does OR when we cannot tell (lenient by design).
     */
    function appliesColor(node, depth = 0) {
      const target = unwrap(node);
      if (!target || depth > MAX_DEPTH) return true;

      switch (target.type) {
        case "ObjectExpression":
          return target.properties.some((prop) =>
            prop.type === "SpreadElement"
              ? appliesColor(prop.argument, depth + 1)
              : propertyIsColor(prop),
          );

        case "ArrayExpression":
          return target.elements.some((el) => el && appliesColor(el, depth + 1));

        case "Identifier": {
          const init = resolveIdentifier(target);
          return init ? appliesColor(init, depth + 1) : true;
        }

        case "MemberExpression": {
          // styles.foo — resolve the container, then the named entry.
          if (target.object.type !== "Identifier" || target.computed) return true;
          const container = unwrap(resolveIdentifier(target.object));
          if (container?.type !== "ObjectExpression") return true;
          const entry = container.properties.find(
            (p) => p.type === "Property" && !p.computed && p.key.name === target.property.name,
          );
          return entry ? appliesColor(entry.value, depth + 1) : true;
        }

        // One branch without a color is still a bug, but flagging those creates
        // more noise than it catches — only report when neither branch has one.
        case "ConditionalExpression":
          return appliesColor(target.consequent, depth + 1) || appliesColor(target.alternate, depth + 1);
        case "LogicalExpression":
          return appliesColor(target.left, depth + 1) || appliesColor(target.right, depth + 1);

        // Function calls, imports, anything else: assume it is handled.
        default:
          return true;
      }
    }

    return {
      JSXOpeningElement(node) {
        if (!isTextName(node.name)) return;
        if (hasTextAncestor(node)) return;

        let styleValue = null;
        for (const attr of node.attributes) {
          if (attr.type === "JSXSpreadAttribute") return; // {...props} may carry style
          const name = attr.name?.name;
          if (name === "color") return;
          if (name === "style") styleValue = attr.value;
        }

        if (!styleValue) {
          context.report({ node, messageId: "missingColor" });
          return;
        }
        if (styleValue.type !== "JSXExpressionContainer") return;
        if (!appliesColor(styleValue.expression)) {
          context.report({ node, messageId: "missingColor" });
        }
      },
    };
  },
};

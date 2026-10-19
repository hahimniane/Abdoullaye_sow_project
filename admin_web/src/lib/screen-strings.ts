// Test support (never imported by the app): the English a console screen
// shows, read from its source. A new console screen gets a French scan test
// built on this (testing-agent.md), so a string added in English only fails
// `npm test` instead of reaching a French page. It takes no dictionary
// itself: only tests may import french-dom.ts statically.

import ts from "typescript";

const ATTRIBUTES_WITH_COPY = new Set(["placeholder", "title", "aria-label", "label", "alt"]);
const SPEAKING_CALLS = new Set(["setError", "setFlash", "setNotice", "setPhoneNotice", "setPhoneError"]);

/** The English a file shows: JSX text, copy attributes, and the messages its handlers raise. */
export function screenStrings(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Set<string>();
  const add = (raw: string) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (/[A-Za-z]{2}/.test(value)) found.add(value);
  };
  const literalsOf = (node: ts.Node | undefined): void => {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isParenthesizedExpression(node)) literalsOf(node.expression);
    else if (ts.isConditionalExpression(node)) { literalsOf(node.whenTrue); literalsOf(node.whenFalse); }
    else if (ts.isBinaryExpression(node)) { literalsOf(node.right); }
    else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) if (ts.isPropertyAssignment(prop) && prop.name.getText() === "message") literalsOf(prop.initializer);
    }
  };
  const optedOut = (node: ts.Node): boolean => {
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
      const attrs = ts.isJsxElement(at) ? at.openingElement.attributes : ts.isJsxSelfClosingElement(at) ? at.attributes : null;
      if (attrs?.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "data-no-translate")) return true;
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && !optedOut(node)) add(node.getText().replace(/&amp;/g, "&").replace(/&apos;/g, "'"));
    if (ts.isJsxAttribute(node) && ATTRIBUTES_WITH_COPY.has(node.name.getText()) && !optedOut(node)) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init.text);
      else if (init && ts.isJsxExpression(init)) literalsOf(init.expression);
    }
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && !optedOut(node)) literalsOf(node.expression);
    // Props that are labels: the code entry's verify words, the back link.
    if (ts.isJsxAttribute(node) && /Label$/.test(node.name.getText())) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init.text);
    }
    if (ts.isCallExpression(node) && SPEAKING_CALLS.has(node.expression.getText())) node.arguments.forEach(literalsOf);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found];
}

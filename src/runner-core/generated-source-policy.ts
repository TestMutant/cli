import ts from "typescript";

const ALLOWED_IMPORT = "@playwright/test";
const FORBIDDEN_IDENTIFIERS = new Set([
  "process",
  "require",
  "eval",
  "Function",
  "fetch",
  "WebSocket",
  "Bun",
  "Deno",
]);

export type GeneratedSourcePolicyResult =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Generated source runs in a privileged runner process. This intentionally
 * narrow policy permits browser assertions while excluding Node and network
 * escape hatches that could access runner configuration or session state.
 */
export function validateGeneratedPlaywrightSource(
  source: string,
  explicitSecrets: string[] = [],
): GeneratedSourcePolicyResult {
  if (!source.trim()) {
    return { valid: false, error: "Generated Playwright source is required." };
  }

  for (const secret of explicitSecrets) {
    if (secret && source.includes(secret)) {
      return { valid: false, error: "Generated source contains a protected credential value." };
    }
  }

  const file = ts.createSourceFile(
    "generated.spec.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (file as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    return { valid: false, error: "Generated Playwright source has TypeScript syntax errors." };
  }

  let importCount = 0;
  let error: string | null = null;
  const reject = (message: string) => {
    error ??= message;
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      importCount += 1;
      if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== ALLOWED_IMPORT) {
        reject(`Only '${ALLOWED_IMPORT}' may be imported by generated tests.`);
      }
    }

    if (ts.isImportEqualsDeclaration(node)) {
      reject("Generated tests may not use import-equals declarations.");
    }

    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      reject("Generated tests may not use dynamic imports.");
    }

    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      reject(`Generated tests may not use '${node.text}'.`);
    }

    if (ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "page" &&
        (node.name.text === "context" || node.name.text === "request")) {
      reject("Generated tests may not access browser context, cookies, or request clients.");
    }

    ts.forEachChild(node, visit);
  };
  visit(file);

  if (error) {
    return { valid: false, error };
  }

  if (importCount !== 1 || !/\btest\s*\(/.test(source)) {
    return {
      valid: false,
      error: "Generated source must import '@playwright/test' and define a Playwright test.",
    };
  }

  return { valid: true };
}

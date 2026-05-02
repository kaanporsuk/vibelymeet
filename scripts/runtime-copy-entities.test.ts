import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const scanRoots = ["src", "apps", "shared"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const skippedDirectories = new Set(["node_modules", "dist", "build", "coverage", ".expo", ".turbo"]);
const htmlEntityPattern = /&(?:[a-zA-Z][a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);/;

interface RuntimeEntityHit {
  path: string;
  line: number;
  snippet: string;
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        files.push(...collectSourceFiles(join(dir, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(join(dir, entry.name));
    }
  }

  return files;
}

function scriptKindFor(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }

  return null;
}

function isJsxDecodedAttributeLiteral(node: ts.Node): boolean {
  return ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent);
}

function isTypeOnlyLiteral(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isLiteralTypeNode(current)) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function functionNameFor(node: ts.Node): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
    return node.name.text;
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;

    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }

    if (ts.isPropertyAssignment(parent)) {
      if (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) {
        return parent.name.text;
      }
    }
  }

  return null;
}

function isInsideIntentionalEscapeHelper(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    const name = functionNameFor(current);
    if (name && /^(?:escape|encode).*(?:html|xml)$/i.test(name)) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function collectRuntimeEntityHits(path: string): RuntimeEntityHit[] {
  const sourceText = readFileSync(path, "utf8");
  if (!htmlEntityPattern.test(sourceText)) {
    return [];
  }

  const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(path));
  const hits: RuntimeEntityHit[] = [];
  const relativePath = path.replace(`${root}/`, "");

  function visit(node: ts.Node): void {
    const text = literalText(node);

    if (
      text &&
      htmlEntityPattern.test(text) &&
      !isJsxDecodedAttributeLiteral(node) &&
      !isTypeOnlyLiteral(node) &&
      !isInsideIntentionalEscapeHelper(node)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      hits.push({
        path: relativePath,
        line: line + 1,
        snippet: node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 140),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return hits;
}

test("runtime copy strings do not leak HTML entities into rendered UI", () => {
  const hits = scanRoots.flatMap((scanRoot) => collectSourceFiles(join(root, scanRoot)).flatMap(collectRuntimeEntityHits));

  assert.deepEqual(
    hits,
    [],
    `Found HTML entities in runtime string/template literals:\n${hits
      .map((hit) => `- ${hit.path}:${hit.line} ${hit.snippet}`)
      .join("\n")}`,
  );
});

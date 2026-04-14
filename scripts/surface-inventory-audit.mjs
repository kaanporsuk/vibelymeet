#!/usr/bin/env node
/**
 * Static import graph from src/App.tsx following relative + TS path aliases (@/, @shared/, @clientShared/).
 * Orphan = file under src/pages|hooks|components not in graph.
 *
 * Usage: node scripts/surface-inventory-audit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function resolveSpecifier(spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith("@shared/"))
    base = path.join(ROOT, "supabase/functions/_shared", spec.slice("@shared/".length));
  else if (spec.startsWith("@clientShared/"))
    base = path.join(ROOT, "shared", spec.slice("@clientShared/".length));
  else return null;

  const exts = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];
  for (const ext of exts) {
    const tryPath = base + ext;
    if (fs.existsSync(tryPath) && fs.statSync(tryPath).isFile()) return path.normalize(tryPath);
  }
  return null;
}

function resolveRelative(fromFile, spec) {
  const dir = path.dirname(fromFile);
  let resolved = path.resolve(dir, spec);
  const exts = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];
  for (const ext of exts) {
    const tryPath = resolved + ext;
    if (fs.existsSync(tryPath) && fs.statSync(tryPath).isFile()) return path.normalize(tryPath);
  }
  return null;
}

/** All static imports with resolvable local paths (src, shared, supabase _shared). */
function resolveImports(fromFile, source) {
  const out = [];
  const re =
    /(?:import|export)\s+[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) {
    const spec = m[1] || m[2];
    if (!spec || spec.startsWith("node:")) continue;
    if (
      spec.startsWith("@/") ||
      spec.startsWith("@shared/") ||
      spec.startsWith("@clientShared/")
    ) {
      const abs = resolveSpecifier(spec);
      if (abs) out.push(abs);
      continue;
    }
    if (spec.startsWith(".")) {
      const abs = resolveRelative(fromFile, spec);
      if (
        abs &&
        (abs.startsWith(SRC) ||
          abs.startsWith(path.join(ROOT, "shared")) ||
          abs.startsWith(path.join(ROOT, "supabase/functions/_shared")))
      )
        out.push(abs);
    }
  }
  return out;
}

function collectReachableFromEntry(entryAbs) {
  const seen = new Set();
  const stack = [entryAbs];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let src;
    try {
      src = read(f);
    } catch {
      continue;
    }
    for (const imp of resolveImports(f, src)) {
      if (!seen.has(imp)) stack.push(imp);
    }
  }
  return seen;
}

const appEntry = path.join(SRC, "App.tsx");
const reachable = collectReachableFromEntry(appEntry);

function orphansUnder(subdir) {
  const absDir = path.join(SRC, subdir);
  const files = walk(absDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  return files
    .filter((f) => !reachable.has(path.normalize(f)))
    .map((f) => path.relative(ROOT, f))
    .sort();
}

const orphanPages = orphansUnder("pages");
const orphanHooks = orphansUnder("hooks");
const orphanComponents = orphansUnder("components");

const report = {
  generated_at: new Date().toISOString().slice(0, 10),
  reachable_modules_in_graph: reachable.size,
  orphan_pages: orphanPages,
  orphan_hooks: orphanHooks,
  orphan_components: orphanComponents,
  caveats: [
    "Graph starts at src/App.tsx; follows @/, @shared/, @clientShared/, and relative imports.",
    "Dynamic import() and string-based lazy() paths are not analyzed.",
    "Files only loaded by Vite glob or runtime strings may false-positive as orphans.",
  ],
};

console.log(JSON.stringify(report, null, 2));

const outMd = path.join(ROOT, "docs", "audits", "surface-inventory-candidates-2026-04-14.md");
fs.writeFileSync(
  outMd,
  `# Surface inventory candidates (mechanical)

**Generated:** ${report.generated_at} via \`node scripts/surface-inventory-audit.mjs\`

## Method

Static import graph from \`src/App.tsx\`, expanding \`@/*\`, \`@shared/*\`, \`@clientShared/*\`, and relative imports.

## Summary

| Bucket | Orphan count |
|--------|----------------|
| \`src/pages\` | **${orphanPages.length}** |
| \`src/hooks\` | **${orphanHooks.length}** |
| \`src/components\` | **${orphanComponents.length}** |
| Modules in graph | **${reachable.size}** |

## Orphan pages (${orphanPages.length})

${orphanPages.length ? orphanPages.map((l) => "- `" + l + "`").join("\n") : "_None._"}

## Orphan hooks (${orphanHooks.length})

${orphanHooks.length ? orphanHooks.map((l) => "- `" + l + "`").join("\n") : "_None._"}

## Orphan components (${orphanComponents.length})

${orphanComponents.length ? orphanComponents.slice(0, 150).map((l) => "- `" + l + "`").join("\n") : "_None._"}
${orphanComponents.length > 150 ? `\n\n… (${orphanComponents.length - 150} more; see JSON stdout)\n` : ""}

## Caveats

${report.caveats.map((c) => `- ${c}`).join("\n")}
`
);
console.error(`\nWrote ${path.relative(ROOT, outMd)}`);

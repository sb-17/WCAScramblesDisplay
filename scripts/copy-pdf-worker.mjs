/**
 * Copies pdf.js's worker into public/ so it can be served from a stable path.
 *
 * Referencing it through the bundler instead would tie this to whichever bundler is in use
 * and how it resolves assets inside a dependency. Copying keeps the worker in step with the
 * installed version automatically, which committing a vendored copy would not.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = join(dirname(require.resolve("pdfjs-dist/package.json")), "legacy/build/pdf.worker.min.mjs");
const target = join(process.cwd(), "public", "pdf.worker.min.mjs");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`pdf.js worker -> ${target}`);

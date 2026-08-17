/**
 * Sanity-check a real TNoodle archive against the parser.
 *
 *   npm run parse -- "C:\path\to\scrambles.zip" MASTERPASSWORD
 *
 * Passcodes are masked. Pass --show-passcodes only if you know the archive is
 * throwaway test data.
 */
import { readFile } from "node:fs/promises";
import { configure } from "@zip.js/zip.js";
import { parseScrambleZip } from "./parse";

// Node has no DOM workers; the browser keeps them so a large archive does not block the UI.
configure({ useWebWorkers: false });

const args = process.argv.slice(2);
const showPasscodes = args.includes("--show-passcodes");
const [archivePath, masterPassword] = args.filter((a) => !a.startsWith("--"));

if (!archivePath || !masterPassword) {
  console.error('Usage: npm run parse -- "<path to zip>" <master password> [--show-passcodes]');
  process.exit(1);
}

const isPdfLocked = (bytes: Uint8Array): boolean => {
  const tail = new TextDecoder("latin1").decode(bytes.subarray(-4096));
  return tail.includes("/Encrypt");
};

const parsed = await parseScrambleZip(new Blob([await readFile(archivePath)]), masterPassword);

console.log(`\nCompetition: ${parsed.competitionName}`);
console.log(`Scramble sets: ${parsed.sets.length}\n`);

console.table(
  parsed.sets.map((set) => ({
    event: set.identity?.event ?? "??",
    round: set.identity?.round ?? "??",
    set: set.identity?.set ?? "??",
    label: set.label,
    kb: Math.round(set.pdfBytes.length / 1024),
    locked: isPdfLocked(set.pdfBytes) ? "yes" : "NO",
    passcode: showPasscodes ? set.passcode : "*".repeat(set.passcode.length),
  })),
);

if (parsed.warnings.length) {
  console.log(`\n${parsed.warnings.length} warning(s):`);
  for (const warning of parsed.warnings) {
    console.log(`  [${warning.kind}] ${warning.label}`);
  }
} else {
  console.log("\nNo warnings -- every PDF matched a passcode and every label parsed.");
}

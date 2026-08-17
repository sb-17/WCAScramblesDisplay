/**
 * Builds a synthetic TNoodle-shaped archive and runs the parser over it, so the
 * zip layering, the passcode join and the warning cases can be exercised without
 * touching real scramble data.
 *
 *   npm run selftest
 */
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter, configure } from "@zip.js/zip.js";
import { parseScrambleZip } from "./parse";
import { packSet, unpackSet } from "./payload";

configure({ useWebWorkers: false });

const MASTER = "master-pw-123";

const SECRET = `SECRET SCRAMBLE SET PASSCODES
Test Competition Scrambles

Make sure that only Delegates have access to this file.
Give passcodes to scramblers when the corresponding
groups begin (but not earlier). If you have to put
someone else in charge of the passcodes temporarily,
only give them the minimum amount of passcodes needed.

3x3x3 Round 1 Scramble Set A: fcse9ze8
3x3x3 Round 1 Scramble Set B: p4uydzdp
3x3x3 Blindfolded Round 2 Scramble Set A: yxy85drm
Megaminx Round 1 Scramble Set A: 3m35x29y
Weird Unnumbered Sheet: abcd1234
3x3x3 Round 9 Scramble Set A: orphan99
`;

/** Mirrors SECRET above, minus the orphan, plus one PDF with no passcode line. */
const PDF_LABELS = [
  "3x3x3 Round 1 Scramble Set A",
  "3x3x3 Round 1 Scramble Set B",
  "3x3x3 Blindfolded Round 2 Scramble Set A",
  "Megaminx Round 1 Scramble Set A",
  "Weird Unnumbered Sheet",
  "2x2x2 Round 1 Scramble Set A",
];

const fakePdf = (label: string) =>
  new TextEncoder().encode(`%PDF-1.4\n% ${label}\ntrailer<</Encrypt 1 0 R>>\n%%EOF\n`);

async function buildInnerZip(): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const label of PDF_LABELS) {
    await writer.add(`${label}.pdf`, new Uint8ArrayReader(fakePdf(label)));
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

async function buildOuterZip(): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { password: MASTER });
  await writer.add("Interchange/ignored.json", new TextReader("{}"));
  await writer.add("Printing/ignored.pdf", new TextReader("nope"));
  await writer.add(
    "Test Competition Scrambles - Computer Display PDF Passcodes - SECRET.txt",
    new TextReader(SECRET),
  );
  await writer.add(
    "Test Competition Scrambles - Computer Display PDFs.zip",
    new Uint8ArrayReader(await buildInnerZip()),
  );
  return writer.close();
}

const parsed = await parseScrambleZip(await buildOuterZip(), MASTER);

console.log(`competitionName: ${JSON.stringify(parsed.competitionName)}`);
console.log(`sets: ${parsed.sets.length}\n`);
for (const set of parsed.sets) {
  const identity = set.identity
    ? `${set.identity.event} / R${set.identity.round} / ${set.identity.set}`
    : "(no identity)";
  console.log(`  ${set.label}`);
  console.log(`      -> ${identity}   passcode=${set.passcode}   ${set.pdfBytes.length}B`);
}

console.log(`\nwarnings: ${parsed.warnings.length}`);
for (const warning of parsed.warnings) console.log(`  [${warning.kind}] ${warning.label}`);

console.log("\n--- wrong master password should fail ---");
try {
  await parseScrambleZip(await buildOuterZip(), "wrong");
  console.log("  FAIL: no error raised");
} catch (err) {
  console.log(`  ok: ${(err as Error).message}`);
}

// PDF bytes are arbitrary, so the pack format must survive a payload that happens to
// contain the same bytes the length prefix uses.
console.log("\n--- set payload packing ---");
{
  const awkward = new Uint8Array([0x00, 0x08, 0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);
  const round = unpackSet(packSet(awkward, "fcse9ze8"));
  const pdfMatches =
    round.pdf.length === awkward.length && round.pdf.every((b, i) => b === awkward[i]);
  console.log(`  ${pdfMatches ? "ok  " : "FAIL"}  pdf round trips byte for byte`);
  console.log(`  ${round.passcode === "fcse9ze8" ? "ok  " : "FAIL"}  passcode round trips`);

  const empty = unpackSet(packSet(new Uint8Array(0), ""));
  console.log(
    `  ${empty.pdf.length === 0 && empty.passcode === "" ? "ok  " : "FAIL"}  empty payload round trips`,
  );

  try {
    unpackSet(new Uint8Array([0x00]));
    console.log("  FAIL  truncated payload accepted");
  } catch {
    console.log("  ok    truncated payload rejected");
  }
}

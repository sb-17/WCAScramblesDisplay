import {
  BlobReader,
  TextWriter,
  Uint8ArrayWriter,
  ZipReader,
  configure,
  type FileEntry,
} from "@zip.js/zip.js";

configure({ useWebWorkers: false });

/**
 * A TNoodle scrambles archive looks like this:
 *
 *   outer.zip                         encrypted with the competition master password
 *   |- Interchange/                   ignored
 *   |- Printing/                      ignored
 *   |- <comp> - ... SECRET.txt        every scramble set's passcode, plaintext
 *   \- <comp> - ... PDFs.zip          not encrypted
 *      \- <label>.pdf                 each locked with its own passcode
 *
 * The PDFs stay byte-identical to what TNoodle produced -- we never re-encode
 * them, so scramble diagrams cannot be corrupted in transit.
 */

const IGNORED_DIRS = /(^|\/)(interchange|printing)\//i;
const LABEL = /^(?<event>.+?) Round (?<round>\d+) Scramble Set (?<set>[A-Za-z]+)$/;

export interface SetIdentity {
  event: string;
  round: number;
  set: string;
}

export interface ScrambleSet {
  /** Filename minus `.pdf`, which is also the exact key used in the passcode file. */
  label: string;
  passcode: string;
  pdfBytes: Uint8Array;
  /** null when the label does not follow the usual naming -- the set is still usable. */
  identity: SetIdentity | null;
}

export interface ParseWarning {
  kind: "pdf-without-passcode" | "passcode-without-pdf" | "unrecognised-label";
  label: string;
}

export interface ParsedScrambles {
  competitionName: string;
  sets: ScrambleSet[];
  warnings: ParseWarning[];
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function parseLabel(label: string): SetIdentity | null {
  const groups = LABEL.exec(label)?.groups;
  if (!groups?.event || !groups.round || !groups.set) return null;
  return { event: groups.event, round: Number(groups.round), set: groups.set };
}

/**
 * The passcode file opens with a free-form warning block, so lines are picked by
 * shape rather than by position. Splitting on the *last* colon means an event name
 * containing one cannot swallow part of the passcode.
 */
function parsePasscodes(text: string): Map<string, string> {
  const passcodes = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const split = line.lastIndexOf(":");
    if (split <= 0) continue;

    const label = line.slice(0, split).trim();
    const passcode = line.slice(split + 1).trim();
    if (!label || !passcode || /\s/.test(passcode)) continue;

    passcodes.set(label, passcode);
  }
  return passcodes;
}

function competitionNameFrom(txtFilename: string): string {
  return basename(txtFilename)
    .replace(/\.txt$/i, "")
    .replace(/\s*-\s*Computer Display PDF Passcodes\s*-\s*SECRET$/i, "")
    .trim();
}

async function entriesOf(
  blob: Blob,
  password?: string,
): Promise<[FileEntry[], ZipReader<unknown>]> {
  const reader = new ZipReader(new BlobReader(blob), password ? { password } : undefined);
  const entries = (await reader.getEntries()).filter(
    (entry): entry is FileEntry => !entry.directory && !IGNORED_DIRS.test(entry.filename),
  );
  return [entries, reader];
}

export async function parseScrambleZip(
  archive: Blob,
  masterPassword: string,
): Promise<ParsedScrambles> {
  const [outerEntries, outer] = await entriesOf(archive, masterPassword);
  try {
    const txt = outerEntries.find((e) => e.filename.toLowerCase().endsWith(".txt"));
    const nested = outerEntries.find((e) => e.filename.toLowerCase().endsWith(".zip"));
    if (!txt) throw new Error("No passcode .txt found in the archive.");
    if (!nested) throw new Error("No nested PDF .zip found in the archive.");

    const passcodes = parsePasscodes(await txt.getData(new TextWriter()));
    const nestedBytes = await nested.getData(new Uint8ArrayWriter());

    const [pdfEntries, inner] = await entriesOf(new Blob([nestedBytes]));
    try {
      const sets: ScrambleSet[] = [];
      const warnings: ParseWarning[] = [];
      const matched = new Set<string>();

      for (const entry of pdfEntries) {
        if (!entry.filename.toLowerCase().endsWith(".pdf")) continue;

        const label = basename(entry.filename).replace(/\.pdf$/i, "");
        matched.add(label);

        const passcode = passcodes.get(label);
        if (!passcode) {
          warnings.push({ kind: "pdf-without-passcode", label });
          continue;
        }

        const identity = parseLabel(label);
        if (!identity) warnings.push({ kind: "unrecognised-label", label });

        sets.push({
          label,
          passcode,
          pdfBytes: await entry.getData(new Uint8ArrayWriter()),
          identity,
        });
      }

      for (const label of passcodes.keys()) {
        if (!matched.has(label)) warnings.push({ kind: "passcode-without-pdf", label });
      }

      return { competitionName: competitionNameFrom(txt.filename), sets, warnings };
    } finally {
      await inner.close();
    }
  } finally {
    await outer.close();
  }
}

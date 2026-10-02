import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";

export const MAX_OFFICIAL_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 4096;
const MAX_DOCUMENT_BYTES = 128 * 1024;

/** Extract only ordinary files into a private, empty temporary directory.
 * Both ZIP metadata and actual decompressed bytes are bounded before import.
 * The caller always removes the entire temporary directory, including on error.
 */
export async function extractOfficialSkill(
  bytes: Buffer,
  expected: { size_bytes: number; sha256: string },
  directory: string,
): Promise<string> {
  if (!Number.isSafeInteger(expected.size_bytes) || expected.size_bytes <= 0 ||
      expected.size_bytes > MAX_OFFICIAL_ARCHIVE_BYTES || bytes.length !== expected.size_bytes ||
      !/^[a-f0-9]{64}$/.test(expected.sha256) ||
      createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
    throw new Error("Official skill archive integrity check failed");
  }
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, result) => error || !result ? reject(error) : resolve(result));
  });
  const seen = new Set<string>();
  const documents: string[] = [];
  let total = 0;
  let declared = 0;
  let count = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          const path = entry.fileName;
          const parts = path.replace(/\/$/, "").split("/");
          const directoryEntry = path.endsWith("/");
          const kind = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (++count > MAX_FILES || parts.length > 16 || path.length > 512 ||
              parts.some((part) => !part || part === "." || part === ".." || /[\\:\x00-\x1f]/.test(part) ||
                /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) ||
              (kind !== 0 && kind !== (directoryEntry ? 0x4000 : 0x8000)) ||
              (entry.generalPurposeBitFlag & 1) !== 0 || seen.has(path.toLowerCase())) {
            throw new Error("Unsafe official skill archive entry");
          }
          seen.add(path.toLowerCase());
          declared += entry.uncompressedSize;
          if (declared > MAX_OFFICIAL_ARCHIVE_BYTES || (directoryEntry && entry.uncompressedSize !== 0)) {
            throw new Error("Official skill archive is too large");
          }
          const target = join(directory, ...parts);
          if (directoryEntry) {
            await mkdir(target, { recursive: true });
            zip.readEntry();
            return;
          }
          const stream = await new Promise<NodeJS.ReadableStream>((accept, fail) => {
            zip.openReadStream(entry, (error, value) => error || !value ? fail(error) : accept(value));
          });
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of stream) {
            const data = Buffer.from(chunk);
            length += data.length;
            total += data.length;
            if (total > MAX_OFFICIAL_ARCHIVE_BYTES || length > entry.uncompressedSize ||
                (parts.at(-1) === "SKILL.md" && length > MAX_DOCUMENT_BYTES)) {
              throw new Error("Official skill archive is too large");
            }
            chunks.push(data);
          }
          if (length !== entry.uncompressedSize) throw new Error("Invalid official skill archive size");
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, Buffer.concat(chunks), { flag: "wx", mode: 0o600 });
          if (parts.at(-1) === "SKILL.md") documents.push(target);
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    if (documents.length !== 1) throw new Error("Official archive must contain exactly one SKILL.md");
    const root = dirname(documents[0]);
    // One skill package, optionally wrapped in a single directory; no sibling payloads.
    if (root !== directory && [...seen].some((path) => !path.startsWith(`${root.slice(directory.length + 1).replaceAll("\\", "/").toLowerCase()}/`))) {
      throw new Error("Official archive contains files outside its skill package");
    }
    return root;
  } finally {
    zip.close();
  }
}

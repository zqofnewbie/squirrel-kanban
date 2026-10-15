// Produce a reproducible dependency notice inventory without downloading assets.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sections = [],
  missing = [];
async function license(name, directory, metadata = "") {
  const names = (await readdir(directory))
    .filter((n) => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(n))
    .sort();
  const texts = [];
  for (const n of names) {
    try {
      texts.push(`${n}\n${await readFile(path.join(directory, n), "utf8")}`);
    } catch {}
  }
  if (
    !texts.length &&
    (name.startsWith("@esbuild/") || name.startsWith("@rollup/"))
  ) {
    const parent = name.startsWith("@esbuild/") ? "esbuild" : "rollup";
    texts.push(
      `Native binary; same project license:\n${await readFile(path.join(root, "web/node_modules", parent, "LICENSE.md"), "utf8")}`,
    );
  }
  if (!texts.length) missing.push(name);
  sections.push(
    `${name}${metadata ? ` (${metadata})` : ""}\n${"=".repeat(72)}\n${texts.join("\n") || "No top-level license text found; review upstream terms."}`,
  );
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(directory, entry.name);
    if (entry.name.startsWith("@")) {
      await walk(dir);
      continue;
    }
    const p = JSON.parse(
      await readFile(path.join(dir, "package.json"), "utf8"),
    );
    await license(
      `${p.name}@${p.version}`,
      dir,
      typeof p.license === "string" ? p.license : "",
    );
    try {
      await walk(path.join(dir, "node_modules"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
await walk(path.join(root, "web/node_modules"));
const modules = execFileSync(
  process.env.GO_BINARY || "go",
  ["list", "-m", "-json", "all"],
  { cwd: path.join(root, "server"), encoding: "utf8" },
);
for (const chunk of modules.split(/\n(?=\{)/)) {
  const m = JSON.parse(chunk);
  if (!m.Main && m.Dir) await license(`${m.Path}@${m.Version}`, m.Dir);
}
sections.sort();
await writeFile(
  path.join(root, "docs/dependency-licenses.txt"),
  "Generated dependency license inventory. Third-party terms remain unchanged.\n\n" +
    sections.join("\n\n"),
);
console.log(
  `Recorded ${sections.length} packages. Missing top-level license: ${missing.join(", ") || "none"}`,
);

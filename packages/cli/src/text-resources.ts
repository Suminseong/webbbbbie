import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import project from "../../../package.json";
import { catalogRows, columns, statuses } from "./text-catalog";
import { planImport, readExchange, refreshRows, toCsv } from "./text-exchange";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const catalogFile = fileURLToPath(
  new URL("../../content/text-edits.ko.json", import.meta.url),
);
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

function baseline() {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--",
      "apps/web",
      "packages/content",
      "packages/engine",
    ],
    { cwd: repo, encoding: "utf8" },
  ).trim();
  return { revision, dirty: !!dirty, version: "v" + project.version };
}

async function writeDeliverable(path: string, content: string) {
  const target = resolve(path);
  if (target.toLowerCase() === resolve(catalogFile).toLowerCase())
    throw new Error("The output may not replace the applied catalog.");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, { encoding: "utf8", flag: "wx" });
}

async function exportCopy(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      output: { type: "string" },
      previous: { type: "string" },
      version: { type: "string" },
    },
  });
  if (!values.output) throw new Error("Pass --output <file.csv|file.json>.");
  const format = extname(values.output).toLowerCase();
  if (format !== ".csv" && format !== ".json")
    throw new Error("Export supports UTF-8 CSV and structured JSON.");
  const origin = baseline();
  const previous = values.previous ? await readExchange(values.previous) : [];
  const { rows, changes } = refreshRows(catalogRows(), previous);
  const categories: Record<string, number> = {};
  for (const row of rows)
    categories[row.category] = (categories[row.category] ?? 0) + 1;
  const meta = {
    ...origin,
    version: values.version?.trim() || origin.version,
    total: rows.length,
    categories,
    changes,
  };
  const revision = origin.revision + (origin.dirty ? " + working copy" : "");
  await writeDeliverable(
    values.output,
    format === ".csv"
      ? toCsv(rows, revision)
      : json({ meta, columns, statuses, rows }),
  );
  console.log(json(meta));
}

async function updatedCatalog(input: string, apply: boolean) {
  // Read the workbook before taking the write lock so typing and read retries
  // do not block another application. Always validate against fresh disk state.
  const submitted = await readExchange(input);
  const lockPath = catalogFile + ".lock";
  const handle = apply ? await open(lockPath, "wx") : undefined;
  try {
    const base: string = await readFile(catalogFile, "utf8");
    const edits = JSON.parse(base) as Record<string, string>;
    const { updates, results } = planImport(catalogRows(edits), submitted);
    if (apply && updates.size) {
      const next = Object.fromEntries(
        Object.entries({ ...edits, ...Object.fromEntries(updates) }).sort(
          ([a], [b]) => a.localeCompare(b),
        ),
      );
      const temporary = catalogFile + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, json(next), {
          encoding: "utf8",
          flag: "wx",
        });
        if (base !== (await readFile(catalogFile, "utf8")))
          throw new Error("Catalog changed during import. Run dry-run again.");
        await rename(temporary, catalogFile);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
    const rejected = results.filter((item) => item.state === "REJECTED").length;
    return {
      mode: apply ? "apply" : "dry-run",
      counts: {
        submitted: results.length,
        [apply ? "applied" : "wouldApply"]: updates.size,
        rejected,
        skipped: results.length - updates.size - rejected,
      },
      rows: results.map((item) =>
        item.state === "READY"
          ? { ...item, state: apply ? "APPLIED" : "WOULD_APPLY" }
          : item,
      ),
    };
  } finally {
    if (handle) {
      await handle.close();
      await unlink(lockPath);
    }
  }
}

async function importCopy(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      input: { type: "string" },
      report: { type: "string" },
      apply: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
  if (!values.input || (values.apply && values["dry-run"])) {
    throw new Error(
      "Pass --input <file.xlsx|file.csv> and at most one of --dry-run or --apply.",
    );
  }
  if (values.report) {
    // Reserve a new path before applying so an existing report is never overwritten.
    await writeDeliverable(values.report, "");
  }
  try {
    const report = await updatedCatalog(values.input, !!values.apply);
    if (values.report) {
      await writeFile(resolve(values.report), json(report), "utf8");
      console.log(
        json({
          mode: report.mode,
          counts: report.counts,
          report: resolve(values.report),
        }),
      );
    } else {
      console.log(json(report));
    }
    if (report.counts.rejected) process.exitCode = 2;
  } catch (error) {
    if (values.report)
      await writeFile(
        resolve(values.report),
        json({ error: String(error) }),
        "utf8",
      );
    throw error;
  }
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "export") await exportCopy(args);
  else if (command === "import") await importCopy(args);
  else throw new Error("Use text:export or text:import.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

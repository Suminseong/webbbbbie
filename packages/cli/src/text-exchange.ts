import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse } from "csv-parse/sync";
import readWorkbook from "read-excel-file/node";
import { textIdPattern, textIssue } from "@webbbbbie/content";
import { columns, statuses } from "./text-catalog";
import type { Row } from "./text-catalog";

export type InputRow = { row: number; values: Row; issue?: string };
type Result = {
  row: number;
  text_id: string;
  state: "READY" | "SKIPPED" | "REJECTED";
  reason: string;
  previous?: string;
  revised?: string;
};

function rowsFromGrid(grid: unknown[][]): InputRow[] {
  const header = (grid[0] ?? []).map((value) => String(value ?? "").trim());
  if (
    columns.some(
      (field) => header.filter((value) => value === field).length !== 1,
    )
  ) {
    throw new Error(
      "The TEXTS sheet must contain each exchange column exactly once.",
    );
  }
  return grid.slice(1).flatMap((cells, index) => {
    const values = {} as Row;
    let issue: string | undefined;
    for (const key of columns) {
      const value = cells[header.indexOf(key)];
      if (
        value == null ||
        typeof value === "string" ||
        typeof value === "number"
      ) {
        values[key] = value == null ? "" : String(value);
      } else {
        values[key] = "";
        issue ??= "NON_PLAIN_CELL:" + key;
      }
    }
    return issue || Object.values(values).some((value) => value.trim())
      ? [{ row: index + 2, values, issue }]
      : [];
  });
}

export async function readExchange(path: string): Promise<InputRow[]> {
  const extension = extname(path).toLowerCase();
  if (extension === ".csv") {
    const grid = parse(await readFile(path, "utf8"), {
      bom: true,
      skip_empty_lines: true,
    }) as string[][];
    return rowsFromGrid(grid);
  }
  if (extension !== ".xlsx")
    throw new Error("Use an XLSX file or the UTF-8 CSV exported from TEXTS.");
  const workbook = await readWorkbook(path, { trim: false });
  const sheet = workbook.find((item) => item.sheet === "TEXTS");
  if (!sheet) throw new Error("Missing TEXTS sheet.");
  return rowsFromGrid(sheet.data);
}

const sameSource = (a: Row, b: Row) =>
  (
    [
      "source_text",
      "variables",
      "context",
      "category",
      "group_id",
      "constraints",
    ] as const
  ).every(
    (key) =>
      a[key].replaceAll("\r\n", "\n") === b[key].replaceAll("\r\n", "\n"),
  );
const checkedStatus = (status: string) =>
  statuses.some((value) => value === status);

function frequencies(rows: InputRow[]) {
  const result = new Map<string, number>();
  for (const {
    values: { text_id: id },
  } of rows)
    result.set(id, (result.get(id) ?? 0) + 1);
  return result;
}

export function refreshRows(current: Row[], previous: InputRow[] = []) {
  if (!previous.length)
    return {
      rows: current,
      changes: {
        new: current.length,
        changed: 0,
        kept: 0,
        imported: 0,
        removed: [] as string[],
      },
    };
  const refs = new Map(previous.map((entry) => [entry.values.text_id, entry]));
  const counts = frequencies(previous);
  const ids = new Set(current.map((row) => row.text_id));
  const changes = {
    new: 0,
    changed: 0,
    kept: 0,
    imported: 0,
    removed: [...refs.keys()].filter((id) => !ids.has(id)),
  };
  const rows = current.map((live) => {
    const old = refs.get(live.text_id);
    if (!old) {
      changes.new++;
      return { ...live, notes: "신규 리소스" };
    }
    const prior = old.values;
    if (
      old.issue ||
      counts.get(live.text_id) !== 1 ||
      !checkedStatus(prior.status)
    ) {
      changes.changed++;
      return {
        ...live,
        status: "REVIEW_REQUIRED",
        notes: "이전 워크북 행 검증 필요",
      };
    }
    if (sameSource(live, prior)) {
      changes.kept++;
      return {
        ...live,
        revised_text: prior.revised_text,
        status: prior.status,
        notes: prior.notes,
      };
    }
    if (sameSource(live, { ...prior, source_text: prior.revised_text })) {
      changes.imported++;
      return { ...live, status: "IMPORTED", notes: prior.notes };
    }
    changes.changed++;
    return {
      ...live,
      revised_text: prior.revised_text,
      status: "REVIEW_REQUIRED",
      notes: [
        prior.notes,
        "원문 또는 맥락 변경. 이전 제안을 재확인 후 REVISED로 표시.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
  return { rows, changes };
}

export function planImport(current: Row[], submitted: InputRow[]) {
  const known = new Map(current.map((row) => [row.text_id, row]));
  const counts = frequencies(submitted);
  const updates = new Map<string, string>();
  const results: Result[] = submitted.map(({ row, values: entry, issue }) => {
    const id = entry.text_id;
    const base = { row, text_id: id };
    const reject = (reason: string): Result => ({
      ...base,
      state: "REJECTED",
      reason,
      revised: entry.revised_text,
    });
    const skip = (reason: string): Result => ({
      ...base,
      state: "SKIPPED",
      reason,
    });
    if (issue) return reject(issue);
    if (!textIdPattern.test(id) || !known.has(id)) return reject("UNKNOWN_ID");
    if (counts.get(id) !== 1) return reject("DUPLICATE_ID");
    if (!checkedStatus(entry.status)) return reject("UNKNOWN_STATUS");
    if (!entry.revised_text.trim()) return skip("BLANK_REVISION");
    if (entry.status === "REVIEW_REQUIRED") return skip("AWAITING_REVIEW");
    const live = known.get(id)!;
    if (entry.revised_text === live.source_text) return skip("ALREADY_APPLIED");
    if (!sameSource(entry, live)) return reject("SOURCE_OR_CONTEXT_CHANGED");
    if (entry.status === "IMPORTED")
      return reject("IMPORTED_STATUS_WITH_NEW_TEXT");
    const error = textIssue(live.source_text, entry.revised_text);
    if (error) return reject(error);
    updates.set(id, entry.revised_text);
    return {
      ...base,
      state: "READY",
      reason: "VALID",
      previous: live.source_text,
      revised: entry.revised_text,
    };
  });
  return { updates, results };
}

export function toCsv(rows: Row[], revision: string) {
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const header = [...columns, "source_commit"];
  return (
    "\uFEFF" +
    [
      header,
      ...rows.map((row) => [...columns.map((key) => row[key]), revision]),
    ]
      .map((line) => line.map(quote).join(","))
      .join("\r\n") +
    "\r\n"
  );
}

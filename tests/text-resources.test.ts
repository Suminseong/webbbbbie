import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appliedTexts,
  defaultContent,
  sourceText,
  textIssue,
} from "@webbbbbie/content";
import { catalogRows } from "../packages/cli/src/text-catalog";
import type { Row } from "../packages/cli/src/text-catalog";
import {
  planImport,
  readExchange,
  refreshRows,
  toCsv,
} from "../packages/cli/src/text-exchange";
import type { InputRow } from "../packages/cli/src/text-exchange";

const current = catalogRows({});
const template = current.find((row) => row.text_id === "ui.author.profile")!;
const event = current.find((row) => row.text_id === "event.origin.title")!;
const input = (values: Row, row = 2): InputRow => ({ row, values });

describe("Game text catalog", () => {
  it("has unique IDs, real originals and contiguous event groups", () => {
    expect(new Set(current.map((row) => row.text_id)).size).toBe(
      current.length,
    );
    for (const definition of defaultContent.events) {
      const group = "event." + definition.id;
      const indexes = current.flatMap((row, index) =>
        row.group_id === group ? [index] : [],
      );
      expect(indexes.length).toBeGreaterThanOrEqual(2);
      expect(indexes.at(-1)! - indexes[0] + 1).toBe(indexes.length);
      expect(sourceText(group + ".title")).toBe(definition.title);
      expect(sourceText(group + ".body")).toBe(definition.text);
      for (const choice of definition.choices ?? [])
        expect(sourceText(group + ".choice." + choice.id)).toBe(choice.label);
    }
    expect(current.every((row) => row.context && !row.revised_text)).toBe(true);
    expect(
      catalogRows().filter((row) => row.status === "IMPORTED").length,
    ).toBe(Object.keys(appliedTexts).length);
  });
  it("permits variable order changes and rejects altered, missing and malformed tokens", () => {
    expect(
      textIssue(template.source_text, "{{home}} · {{age}}세 · {{job}}"),
    ).toBeNull();
    expect(textIssue(template.source_text, "{{home}} · {{age}}세")).toBe(
      "VARIABLE_MISMATCH",
    );
    expect(
      textIssue(template.source_text, "{{home}} · {{years}}세 · {{job}}"),
    ).toBe("VARIABLE_MISMATCH");
    expect(
      textIssue(template.source_text, "{{home}} · {{age}}세 · {{job}}{{"),
    ).toBe("MALFORMED_VARIABLE");
  });
});

describe("Gemini exchange", () => {
  it("round-trips UTF-8 CSV, including quotes and newlines", async () => {
    const directory = await mkdtemp(join(tmpdir(), "writerlife-text-"));
    try {
      const path = join(directory, "returned.csv");
      const expected = {
        ...event,
        revised_text: '"수정"\n다음 줄',
        notes: "검토, 메모",
      };
      await writeFile(path, toCsv([expected, template], "abc"));
      expect((await readExchange(path)).map((row) => row.values)).toEqual([
        expected,
        template,
      ]);
    } finally {
      await rm(join(directory, "returned.csv"), { force: true });
      await rmdir(directory);
    }
  });
  it("blocks stale source, stale context, unknown IDs, duplicates, and changed variables while preserving valid rows", () => {
    const extra = current.find((row) => row.text_id === "ui.header.home")!;
    const duplicate = { ...extra, revised_text: "새 문구" };
    const valid = { ...event, revised_text: "작가가 되기로 한 날" };
    const badVariable = { ...template, revised_text: "{{age}}세 · {{job}}" };
    const stale = {
      ...current.find((row) => row.text_id === "ui.header.seed")!,
      source_text: "이전 원문",
      revised_text: "시작 시드",
    };
    const staleContext = {
      ...current.find((row) => row.text_id === "ui.tab.log")!,
      context: "이전 행동",
      revised_text: "일지",
    };
    const unknown = {
      ...event,
      text_id: "event.unknown.title",
      revised_text: "알 수 없음",
    };
    const result = planImport(
      current,
      [
        valid,
        badVariable,
        stale,
        staleContext,
        unknown,
        duplicate,
        duplicate,
      ].map((value, index) => input(value, index + 2)),
    );
    expect([...result.updates]).toEqual([[event.text_id, valid.revised_text]]);
    expect(result.results.map((row) => row.reason)).toEqual([
      "VALID",
      "VARIABLE_MISMATCH",
      "SOURCE_OR_CONTEXT_CHANGED",
      "SOURCE_OR_CONTEXT_CHANGED",
      "UNKNOWN_ID",
      "DUPLICATE_ID",
      "DUPLICATE_ID",
    ]);
    const skipped = planImport(current, [
      input(template),
      input({ ...event, status: "REVIEW_REQUIRED", revised_text: "보류" }),
    ]);
    expect(skipped.updates.size).toBe(0);
    expect(skipped.results.map((row) => row.reason)).toEqual([
      "BLANK_REVISION",
      "AWAITING_REVIEW",
    ]);
  });
  it("keeps pending edits on refresh, marks imported text and identifies changed/new rows", () => {
    const revised = {
      ...event,
      status: "REVISED",
      revised_text: "시작의 까닭",
      notes: "검토 의견",
    };
    const same = refreshRows([event, template], [input(revised)]);
    expect(same.rows[0]).toEqual(revised);
    expect(same.changes).toMatchObject({ kept: 1, new: 1 });
    const done = refreshRows(
      [{ ...event, source_text: revised.revised_text }],
      [input(revised)],
    );
    expect(done.rows[0]).toMatchObject({
      status: "IMPORTED",
      revised_text: "",
    });
    expect(done.changes.imported).toBe(1);
    const stale = refreshRows(
      [{ ...event, context: "시점이 달라짐" }],
      [input(revised)],
    );
    expect(stale.rows[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      revised_text: revised.revised_text,
    });
    expect(
      planImport(
        [{ ...event, source_text: revised.revised_text }],
        [input(revised)],
      ).results[0].reason,
    ).toBe("ALREADY_APPLIED");
  });
});

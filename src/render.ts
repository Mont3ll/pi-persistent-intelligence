import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMemoryDirs } from "./paths";
import { loadAllRecords, slugifyProject } from "./store";
import type { MemoryRecord } from "./types";

function renderRecord(record: MemoryRecord): string {
  if (record.status === "deleted") {
    return [
      `### ${record.id}`,
      "",
      "**Status**: deleted",
      "",
      "_[Deleted record content is omitted from rendered memory. Canonical audit state is retained separately.]_",
    ].join("\n");
  }

  const tags = record.tags.map((tag) => `#${tag}`).join(" ");
  const evidence = record.evidence.map((item) => `- ${item.ref} — ${item.note}`).join("\n");
  const supersession = [
    record.supersedes.length ? `**Supersedes**: ${record.supersedes.join(", ")}` : "",
    record.superseded_by.length ? `**Superseded by**: ${record.superseded_by.join(", ")}` : "",
    record.vault_ref ? `**Vault ref**: ${record.vault_ref}` : "",
  ].filter(Boolean).join("\n");

  return [
    `### ${record.id}`,
    "",
    `**Status**: ${record.status}`,
    `**Confidence**: ${record.confidence.toFixed(2)}`,
    `**Stability**: ${record.stability}`,
    `**Tags**: ${tags}`,
    `**Scope**: ${record.scope.type}${record.scope.project ? `:${record.scope.project}` : ""}`,
    `**Next review**: ${record.review.next_review}`,
    "",
    record.statement,
    "",
    "**Evidence**",
    evidence,
    "",
    "**Change condition**",
    record.review.change_condition,
    supersession ? `\n${supersession}` : "",
  ].filter((part) => part !== "").join("\n");
}

function renderRecordGroup(records: MemoryRecord[], emptyMessage: string): string {
  return records.length ? records.map(renderRecord).join("\n\n") : emptyMessage;
}

export function renderMemoryMarkdown(records: MemoryRecord[]): string {
  const current = records.filter((record) => record.status === "active");
  const contested = records.filter((record) => record.status === "contested");
  const history = records.filter((record) => record.status !== "active" && record.status !== "contested");
  const currentL1 = current.filter((record) => record.layer === "L1");
  const currentL2 = current.filter((record) => record.layer === "L2");

  const sections = [
    "# Long-Term Memory",
    "",
    "> Generated from canonical JSONL. Do not edit directly.",
    "",
    "## L1 — Identity",
    "",
    renderRecordGroup(currentL1, "_No L1 records._"),
    "",
    "## L2 — Playbooks",
    "",
    renderRecordGroup(currentL2, "_No L2 records._"),
    "",
    "## Contested — Review Required",
    "",
    "> Contested memory is not current truth and must be reviewed before use.",
    "",
    renderRecordGroup(contested, "_No contested records._"),
    "",
    "## History",
    "",
    "> Historical memory is retained for audit and temporal context, not as current truth.",
    "",
    renderRecordGroup(history, "_No historical records._"),
    "",
  ];
  return sections.join("\n");
}

export function renderMemoryToDisk(root: string): string {
  const paths = ensureMemoryDirs(root);
  const records = loadAllRecords(root);
  const markdown = renderMemoryMarkdown(records);
  writeFileSync(paths.rendered.memory, markdown, "utf-8");

  const byProject = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    if (record.scope.type !== "project" || !record.scope.project) continue;
    const existing = byProject.get(record.scope.project) ?? [];
    existing.push(record);
    byProject.set(record.scope.project, existing);
  }
  for (const [project, projectRecords] of byProject) {
    writeFileSync(join(paths.rendered.projects, `${slugifyProject(project)}.md`), renderMemoryMarkdown(projectRecords), "utf-8");
  }
  return markdown;
}

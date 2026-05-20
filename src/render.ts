import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMemoryDirs } from "./paths";
import { loadAllRecords, slugifyProject } from "./store";
import type { MemoryRecord } from "./types";

function renderRecord(record: MemoryRecord): string {
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

export function renderMemoryMarkdown(records: MemoryRecord[]): string {
  const visible = records.filter((record) => record.status !== "deleted");
  const l1 = visible.filter((record) => record.layer === "L1");
  const l2 = visible.filter((record) => record.layer === "L2");
  const sections = [
    "# Long-Term Memory",
    "",
    "> Generated from canonical JSONL. Do not edit directly.",
    "",
    "## L1 — Identity",
    "",
    l1.length ? l1.map(renderRecord).join("\n\n") : "_No L1 records._",
    "",
    "## L2 — Playbooks",
    "",
    l2.length ? l2.map(renderRecord).join("\n\n") : "_No L2 records._",
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

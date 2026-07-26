import { describe, expect, test } from "bun:test";
import { classifyCaptureIntent } from "../../src/capture-intent";
import { resolveCaptureScopes } from "../../src/capture-scope";
import type { ProjectIdentity, SessionActivity } from "../../src/types";

function project(project_id: string): ProjectIdentity {
  return { project_id, display_name: project_id, source: "package_name", package_name: project_id };
}

function activity(modified: string[], read: string[] = []): SessionActivity {
  return {
    id: "a1",
    session_id: "s1",
    turn_id: "t1",
    launch_cwd_hash: "hash",
    modified_projects: modified.map(project),
    read_projects: read.map(project),
    modified_path_hashes: [],
    command_classes: [],
    explicit_project_mentions: [],
    created_at: "2026-07-26T00:00:00Z",
  };
}

describe("capture scope", () => {
  test("global writing preference overrides vault launch location and modified repositories", () => {
    const text = "Avoid em dashes in my public writing.";
    const targets = resolveCaptureScopes({
      text,
      decision: classifyCaptureIntent(text),
      launch_project: project("obsidian-vault"),
      activity: [activity(["pi-persistent-intelligence"])],
    });
    expect(targets).toEqual([{ type: "global", confidence: 0.95, basis: ["explicit_user_global"] }]);
  });

  test("ordinary personal preference stays global despite repository activity", () => {
    const text = "I prefer plain punctuation.";
    const targets = resolveCaptureScopes({ text, decision: classifyCaptureIntent(text), launch_project: project("repo-a"), activity: [activity(["repo-a"])] });
    expect(targets).toEqual([{ type: "global", confidence: 0.9, basis: ["personal_preference"] }]);
  });

  test("replicates non-global rule to every modified repository", () => {
    const text = "Before publishing, run the release audit and package dry-run.";
    const targets = resolveCaptureScopes({
      text,
      decision: classifyCaptureIntent(text),
      launch_project: project("obsidian-vault"),
      activity: [activity(["pi-persistent-intelligence", "pi-governance-rs"])],
    });
    expect(targets.map((item) => item.project).sort()).toEqual(["pi-governance-rs", "pi-persistent-intelligence"]);
    expect(targets.every((item) => item.basis.includes("modified_project"))).toBe(true);
  });

  test("does not target a read-only repository", () => {
    const text = "Before publishing, run the release audit.";
    const targets = resolveCaptureScopes({
      text,
      decision: classifyCaptureIntent(text),
      launch_project: project("obsidian-vault"),
      activity: [activity(["repo-a"], ["reference-repo"])],
    });
    expect(targets.map((item) => item.project)).toEqual(["repo-a"]);
  });

  test("uses explicit project restriction instead of every modified repository", () => {
    const text = "In pi-governance-rs, always run cargo test before release.";
    const row = activity(["pi-governance-rs", "pi-persistent-intelligence"]);
    row.explicit_project_mentions = ["pi-governance-rs"];
    const targets = resolveCaptureScopes({ text, decision: classifyCaptureIntent(text), launch_project: project("obsidian-vault"), activity: [row] });
    expect(targets.map((item) => item.project)).toEqual(["pi-governance-rs"]);
  });

  test("uses vault scope only for vault-specific behavior", () => {
    const text = "Do not edit canonical source bodies in this vault.";
    const targets = resolveCaptureScopes({
      text,
      decision: classifyCaptureIntent(text),
      launch_project: project("obsidian-vault"),
      activity: [activity([])],
    });
    expect(targets).toEqual([{ type: "project", project: "obsidian-vault", confidence: 0.95, basis: ["explicit_vault_scope"] }]);
  });
});

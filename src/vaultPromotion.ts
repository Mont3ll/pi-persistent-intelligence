import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMemoryDirs } from "./paths";
import type { PatchOp } from "./types";

export function writeVaultPromotionReport(root: string, patchId: string, op: PatchOp): string {
  const paths = ensureMemoryDirs(root);
  const file = join(paths.reports, `vault-promotion-${patchId}-${op.op_id}.md`);
  const record = op.record ?? op.to_record;
  const lines = [
    "# Vault Promotion Candidate",
    "",
    `Patch: ${patchId}`,
    `Operation: ${op.op_id}`,
    `Target: ${op.target_id ?? record?.id ?? "unknown"}`,
    "",
    "## Reason",
    op.reason ?? op.rationale ?? "No reason supplied.",
    "",
    "## Candidate statement",
    record?.statement ?? "No canonical record attached to this operation.",
    "",
    "## Next steps",
    "- Review against the target vault's AGENTS.md or equivalent schema.",
    "- Create or update cited wiki pages manually; this report does not mutate the vault.",
    "- Link the resulting vault page back to the memory record with `vault_ref` in a later patch.",
    "",
  ];
  writeFileSync(file, lines.join("\n"), "utf-8");
  return file;
}

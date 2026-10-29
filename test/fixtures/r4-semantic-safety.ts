/** Synthetic only: do not copy transcripts, contact information, or local paths here. */
export const nondurableSourceControls = [
  "Verification handoff: For this project, always use the amber-release signoff checklist. Report the checks only.",
  "Reverify the release at the exact HEAD. Going forward, do not merge without approval. Do not modify source. Stop after the report.",
  "Task wrapper: For this project, always use the temporary green-audit label in this sprint's test.",
  "The quoted UI example says: For this project, always use amber headings.",
  "Do not remember this as a preference: For this project, always use amber headings.",
  "Delegated agent instructions: For this project, always use the temporary verification label.",
  "For this project, always use the sample release sentence from the quoted example in this sprint.",
] as const;

export const scopeBypassControls = [
  "Across all projects, always run the shared release audit.",
  "In every project, always verify signed package artifacts.",
  "For any project, never run unsigned production builds.",
] as const;

export const durableProjectControls = [
  "For this project, always use the signed-release-checklist before publishing.",
  "This repository always uses Bun for integration tests.",
] as const;

export const optOutControls = [
  "Do not remember this as a preference: For this project, always use amber labels.",
  "Don't save this in memory, even though it says: This repository always uses amber icons.",
  "This is not for long-term memory. For this project, always use temporary notes.",
] as const;

# PI-H1 Verification Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PI verification reproducible by pinning the Bun runtime, defining one PR verification command and one release verification command, and requiring CI and publish workflows to execute those same repository-owned commands.

**Architecture:** Repository scripts in `package.json` are the single source of truth for verification behavior. GitHub Actions installs one pinned Bun runtime from `packageManager`, then delegates to those scripts instead of re-declaring subsets of checks. A repository test protects the contract so future workflow edits cannot silently drift away from local verification.

**Tech Stack:** Bun 1.3.13, TypeScript, `bun:test`, GitHub Actions, npm package dry-run.

**Spec:** `docs/superpowers/specs/2026-09-11-pi-governance-maturity-program-design.md`

## Global Constraints

- PI-H1 changes verification and release correctness only. Do not add retrieval, memory-model, lifecycle, UI, or Wiki behavior.
- The exact commit SHA is the unit of verification.
- The local verifier executes commands and reports evidence but does not modify the implementation branch.
- Use test-first changes for the verification contract.
- Use `bun@1.3.13` as the compatibility baseline for this hardening slice. The lockfile already resolves `@types/bun` and `bun-types` at 1.3.13.
- PR verification is `bun run verify:pr`.
- Release verification is `bun run release-audit`.
- Documentation and comments must not use em dashes.

---

### Task 1: Establish the v0.16.0 baseline evidence

**Files:**
- No repository file changes.

**Interfaces:**
- Consumes: base commit `276d98b9d0b0c8c1f077f1ea557cb781125be1df`.
- Produces: a structured verifier result containing the exact SHA, installed Bun version, OS, exit codes, and the first useful failure output for each failing command.

- [ ] **Step 1: Check out the exact v0.16.0 base**

```bash
git fetch origin
git checkout --detach 276d98b9d0b0c8c1f077f1ea557cb781125be1df
git status --short
git rev-parse HEAD
```

Expected: clean worktree and exact SHA `276d98b9d0b0c8c1f077f1ea557cb781125be1df`.

- [ ] **Step 2: Record the local toolchain**

```bash
uname -a
bun --version
node --version
npm --version
```

Expected: commands complete successfully. Preserve versions in the verifier result.

- [ ] **Step 3: Install exactly from the committed lockfile**

```bash
bun install --frozen-lockfile
```

Expected: exit 0. If it fails, stop and report `BLOCKED` with the first useful error because later results would not be comparable.

- [ ] **Step 4: Reproduce the repository checks individually**

```bash
bun test
bun run typecheck
bun run eval
bun run test:stress
npm pack --dry-run
```

Expected: record each exit code independently. Do not repair failures. The existing GitHub Actions run for this SHA is known to be red, so this step determines whether the local environment reproduces the failure and which command owns it.

- [ ] **Step 5: Return the baseline evidence**

```text
VERDICT: PASS | FAIL | BLOCKED
TESTED_SHA: 276d98b9d0b0c8c1f077f1ea557cb781125be1df
PROTOCOL: pi-h1-v1
BUN: <output of bun --version>
NODE: <output of node --version>
NPM: <output of npm --version>
OS: <output of uname -a>

CHECKS:
- bun install --frozen-lockfile: PASS | FAIL
- bun test: PASS | FAIL | NOT_EVALUATED
- bun run typecheck: PASS | FAIL | NOT_EVALUATED
- bun run eval: PASS | FAIL | NOT_EVALUATED
- bun run test:stress: PASS | FAIL | NOT_EVALUATED
- npm pack --dry-run: PASS | FAIL | NOT_EVALUATED

FIRST_FAILURE:
<first useful failure excerpt, or NONE>
```

Expected: evidence only, with no branch modifications.

---

### Task 2: Encode the verification contract as a failing test

**Files:**
- Create: `test/unit/release-verification-contract.test.ts`

**Interfaces:**
- Consumes: `package.json`, `.github/workflows/ci.yml`, `.github/workflows/publish.yml`.
- Produces: a deterministic test that requires one exact Bun pin, one PR verification script, and one release verification script shared by local and GitHub execution.

- [ ] **Step 1: Write the failing contract test**

Create `test/unit/release-verification-contract.test.ts` with:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  packageManager?: string;
  scripts?: Record<string, string>;
};
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const publish = readFileSync(join(root, ".github/workflows/publish.yml"), "utf8");

describe("release verification contract", () => {
  test("pins the Bun runtime in package.json and removes floating workflow pins", () => {
    expect(pkg.packageManager).toBe("bun@1.3.13");
    expect(ci).not.toContain("bun-version: latest");
    expect(publish).not.toContain("bun-version: latest");
  });

  test("defines one repository-owned PR verification command", () => {
    expect(pkg.scripts?.["verify:pr"]).toBe("bun run typecheck && bun test && bun run eval");
    expect(ci).toContain("run: bun run verify:pr");
  });

  test("defines release verification as PR verification plus release-only checks", () => {
    expect(pkg.scripts?.["release-audit"]).toBe(
      "bun run verify:pr && bun run test:stress && npm pack --dry-run",
    );
    expect(publish).toContain("run: bun run release-audit");
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
bun test test/unit/release-verification-contract.test.ts
```

Expected: FAIL because current `package.json` has no `packageManager` or `verify:pr`, both workflows use `bun-version: latest`, and the publish workflow does not invoke `bun run release-audit`.

- [ ] **Step 3: Commit only the failing test**

```bash
git add test/unit/release-verification-contract.test.ts
git commit -m "test: define release verification contract"
```

Expected: the commit intentionally remains RED for this focused test and is handed to the local verifier to prove the test detects the existing drift.

---

### Task 3: Make the repository the source of verification truth

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/publish.yml`
- Test: `test/unit/release-verification-contract.test.ts`

**Interfaces:**
- Consumes: contract defined by Task 2.
- Produces: `packageManager = "bun@1.3.13"`, `scripts["verify:pr"]`, normalized `release-audit`, CI delegation to `verify:pr`, and publish-gate delegation to `release-audit`.

- [ ] **Step 1: Add the exact Bun pin and shared scripts to `package.json`**

Set:

```json
"packageManager": "bun@1.3.13"
```

and make the verification scripts exactly:

```json
"verify:pr": "bun run typecheck && bun test && bun run eval",
"release-audit": "bun run verify:pr && bun run test:stress && npm pack --dry-run",
"prepublishOnly": "bun run verify:pr"
```

Do not change dependency versions in PI-H1.

- [ ] **Step 2: Make CI use the package-level runtime pin and PR verification script**

Change `.github/workflows/ci.yml` so the setup and verification section is:

```yaml
      - name: Set up Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Verify pull request
        run: bun run verify:pr
```

Do not retain a `bun-version` input. `setup-bun@v2` resolves the exact version from `package.json`'s `packageManager` field when no explicit version is supplied.

- [ ] **Step 3: Make the publish gate use the same pin and the complete release audit**

For every `oven-sh/setup-bun@v2` use in `.github/workflows/publish.yml`, remove:

```yaml
with:
  bun-version: latest
```

In the `test` job, keep tag validation and frozen install, then replace the separate test/typecheck commands with:

```yaml
      - name: Run release audit
        run: bun run release-audit
```

Do not change npm OIDC publishing or GitHub Packages authentication behavior.

- [ ] **Step 4: Run the focused contract test to verify GREEN**

```bash
bun test test/unit/release-verification-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run repository V2 verification**

```bash
bun run verify:pr
```

Expected: exit 0. If it fails, report the exact failing sub-command and diagnose before proceeding.

- [ ] **Step 6: Run release V3 command locally**

```bash
bun run release-audit
```

Expected: exit 0, including stress tests and `npm pack --dry-run`.

- [ ] **Step 7: Commit the implementation**

```bash
git add package.json .github/workflows/ci.yml .github/workflows/publish.yml test/unit/release-verification-contract.test.ts
git commit -m "ci: make verification reproducible"
```

Expected: focused test, V2 verification, and V3 release audit all green on the committed SHA.

---

### Task 4: Align contributor documentation with executable verification

**Files:**
- Modify: `docs/wiki/contributing.md`
- Modify: `README.md`
- Test: `test/unit/release-verification-contract.test.ts`

**Interfaces:**
- Consumes: repository scripts from Task 3.
- Produces: public development instructions that reference the same executable commands used by CI and release workflows.

- [ ] **Step 1: Replace stale contributor command guidance**

In `docs/wiki/contributing.md`, document:

```bash
bun install --frozen-lockfile
bun run verify:pr
bun run release-audit
```

State that PI-H1 uses Bun `1.3.13`, declared in `package.json`, and that `verify:pr` is required before a PR while `release-audit` is required before publishing a version.

Remove exact unit-test and eval-category counts from command comments because they drift independently from the commands.

- [ ] **Step 2: Align the README development section**

Replace the five-command development list with:

```bash
bun install --frozen-lockfile
bun run verify:pr
bun run release-audit
```

Explain in one sentence that `verify:pr` runs typecheck, unit tests, and deterministic evals, while `release-audit` adds stress tests and package dry-run validation.

- [ ] **Step 3: Re-run focused and V2 verification**

```bash
bun test test/unit/release-verification-contract.test.ts
bun run verify:pr
```

Expected: both exit 0.

- [ ] **Step 4: Commit documentation alignment**

```bash
git add docs/wiki/contributing.md README.md
git commit -m "docs: align development verification commands"
```

Expected: documentation describes the executable repository contract rather than a parallel manual checklist.

---

### Task 5: Independent exact-SHA verification and PR readiness

**Files:**
- No additional repository changes unless verification finds a defect.

**Interfaces:**
- Consumes: final PI-H1 head SHA.
- Produces: local-verifier V3 evidence and CI evidence for the identical SHA.

- [ ] **Step 1: Local verifier checks out the exact PI-H1 head**

```bash
git fetch origin
git checkout --detach origin/fix/0.16-h1-verification-baseline
git rev-parse HEAD
git status --short
bun --version
```

Expected: clean worktree. Bun must report `1.3.13` after following the repository's normal environment setup. If the locally installed runtime is different, report `BLOCKED` rather than silently verifying a different toolchain.

- [ ] **Step 2: Run focused verification**

```bash
bun install --frozen-lockfile
bun test test/unit/release-verification-contract.test.ts
```

Expected: exit 0.

- [ ] **Step 3: Run V2 and V3 verification**

```bash
bun run verify:pr
bun run release-audit
```

Expected: both exit 0.

- [ ] **Step 4: Return structured evidence**

```text
VERDICT: PASS | FAIL | BLOCKED
PROTOCOL: pi-h1-v1
TESTED_SHA: exact output from git rev-parse HEAD
BASE_SHA: 276d98b9d0b0c8c1f077f1ea557cb781125be1df
BUN: 1.3.13

CHECKS:
- bun install --frozen-lockfile: PASS | FAIL
- bun test test/unit/release-verification-contract.test.ts: PASS | FAIL
- bun run verify:pr: PASS | FAIL
- bun run release-audit: PASS | FAIL

FIRST_FAILURE:
NONE or first useful failure excerpt
```

Expected: no implementation edits from the verifier.

- [ ] **Step 5: Confirm GitHub CI targets the same head SHA**

Compare the PR head SHA, local verifier `TESTED_SHA`, and GitHub Actions `head_sha`.

Expected:

```text
PR HEAD == local TESTED_SHA == CI head_sha
```

Only then mark PI-H1 ready for merge.

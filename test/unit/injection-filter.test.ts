import { describe, expect, test } from "bun:test";
import { shouldInjectMemoryContext, shouldInjectSessionContext } from "../../src/injection-filter";

describe("shouldInjectMemoryContext", () => {
  test("injects for substantive prompts", () => {
    expect(shouldInjectMemoryContext("how do I implement the auth module?")).toBe(true);
    expect(shouldInjectMemoryContext("add a new endpoint for user profiles")).toBe(true);
    expect(shouldInjectMemoryContext("why is the test failing?")).toBe(true);
    expect(shouldInjectMemoryContext("what is the memory governance policy?")).toBe(true);
  });

  test("skips trivial acknowledgements", () => {
    expect(shouldInjectMemoryContext("ok")).toBe(false);
    expect(shouldInjectMemoryContext("thanks")).toBe(false);
    expect(shouldInjectMemoryContext("sounds good")).toBe(false);
    expect(shouldInjectMemoryContext("yes")).toBe(false);
    expect(shouldInjectMemoryContext("continue")).toBe(false);
    expect(shouldInjectMemoryContext("got it.")).toBe(false);
  });

  test("skips slash commands", () => {
    expect(shouldInjectMemoryContext("/curate-memory")).toBe(false);
    expect(shouldInjectMemoryContext("/reload")).toBe(false);
  });

  test("skips very short inputs", () => {
    expect(shouldInjectMemoryContext("hi")).toBe(false);
    expect(shouldInjectMemoryContext("")).toBe(false);
    expect(shouldInjectMemoryContext("   ")).toBe(false);
  });
});

describe("shouldInjectSessionContext", () => {
  test("injects for implementation prompts", () => {
    expect(shouldInjectSessionContext("implement the login flow")).toBe(true);
    expect(shouldInjectSessionContext("fix the null pointer exception")).toBe(true);
  });

  test("skips trivial prompts", () => {
    expect(shouldInjectSessionContext("ok")).toBe(false);
  });
});

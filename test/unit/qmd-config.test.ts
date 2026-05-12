import { describe, expect, test } from "bun:test";
import { qmdSearchArgs, qmdSetupCommands, qmdUpdateArgs } from "../../src/qmd";

describe("configurable qmd collection", () => {
  test("uses supplied collection name in setup/search/update args", () => {
    expect(qmdSetupCommands("/tmp/root", "custom-memory")[0]).toEqual(["collection", "add", "/tmp/root", "--name", "custom-memory"]);
    expect(qmdSearchArgs("hello", "keyword", 3, "custom-memory")).toEqual(["search", "--json", "-c", "custom-memory", "-n", "3", "hello"]);
    expect(qmdUpdateArgs("custom-memory")).toEqual(["update", "-c", "custom-memory"]);
  });
});

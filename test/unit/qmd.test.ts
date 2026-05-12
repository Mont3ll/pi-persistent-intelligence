import { describe, expect, test } from "bun:test";
import { qmdCollectionName, qmdSetupCommands, qmdSearchArgs, qmdUpdateArgs } from "../../src/qmd";

describe("qmd command construction", () => {
  test("uses pi-persistent-intelligence collection name", () => {
    expect(qmdCollectionName).toBe("pi-persistent-intelligence");
  });

  test("builds setup commands for rendered memory root", () => {
    const commands = qmdSetupCommands("/tmp/pi-memory");
    expect(commands[0]).toEqual(["collection", "add", "/tmp/pi-memory", "--name", "pi-persistent-intelligence"]);
    expect(commands[1]).toEqual(["context", "add", "qmd://pi-persistent-intelligence/rendered", "Rendered long-term memory projections", "-c", "pi-persistent-intelligence"]);
  });

  test("builds search and update args", () => {
    expect(qmdSearchArgs("offline RL", "semantic", 5)).toEqual(["vsearch", "--json", "-c", "pi-persistent-intelligence", "-n", "5", "offline RL"]);
    expect(qmdUpdateArgs()).toEqual(["update", "-c", "pi-persistent-intelligence"]);
  });
});

import { describe, expect, test } from "bun:test";
import { createLifecycleHandlers } from "../../src/lifecycle";

describe("lifecycle handler factory", () => {
  test("exposes every stable lifecycle hook", () => {
    const handlers = createLifecycleHandlers({} as any, {} as any, {} as any);
    expect(Object.keys(handlers)).toEqual(["sessionStart", "beforeAgentStart", "agentEnd", "sessionShutdown"]);
  });
});

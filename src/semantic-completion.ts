/**
 * Reject partial or aborted Pi SDK assistant turns even when their text happens
 * to form valid JSON. This is an advisory model-result acceptance boundary,
 * never canonical-memory authorization.
 *
 * The SDK may resolve prompt() normally after a provider abort/error; text
 * alone and process exit 0 are therefore insufficient to certify completion.
 */
export interface SemanticAssistantMessage {
  role: "assistant";
  stopReason?: string;
  errorMessage?: string;
}
export interface SemanticSessionState {
  messages: readonly { role: string; stopReason?: string; errorMessage?: string }[];
  errorMessage?: string;
  isStreaming?: boolean;
}

export function assertSuccessfulSemanticCompletion(
  state: SemanticSessionState,
  deadlineExpired: boolean,
): void {
  if (deadlineExpired) throw new Error("semantic_assessment_deadline_exceeded");
  if (state.isStreaming === true || state.errorMessage) {
    throw new Error("semantic_assessment_incomplete");
  }
  const last = state.messages.at(-1);
  if (!last || last.role !== "assistant"
    || last.stopReason !== "stop" || Boolean(last.errorMessage)) {
    throw new Error("semantic_assessment_incomplete");
  }
}

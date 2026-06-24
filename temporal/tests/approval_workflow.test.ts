import { defaultPayloadConverter } from "@temporalio/common";
import { condition, setHandler } from "@temporalio/workflow";
import {
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalResult,
  ApprovalWorkflow,
  getStatusQuery,
  submitDecisionSignal,
} from "../src/workflows/example/approval_workflow";

jest.mock("@temporalio/workflow", () => ({
  condition: jest.fn(),
  defineQuery: jest.fn((name: string) => name),
  defineSignal: jest.fn((name: string) => name),
  setHandler: jest.fn(),
}));

describe("ApprovalWorkflow", () => {
  const mockedCondition = condition as unknown as jest.Mock;
  const mockedSetHandler = setHandler as unknown as jest.Mock;

  let handlers: Map<unknown, (...args: unknown[]) => unknown>;
  let nextDecision: ApprovalDecision | null;

  beforeEach(() => {
    handlers = new Map();
    nextDecision = null;

    mockedSetHandler.mockImplementation((definition, handler) => {
      handlers.set(definition, handler);
    });

    mockedCondition.mockImplementation(async (predicate) => {
      if (nextDecision !== null) {
        handlers.get(submitDecisionSignal)?.(nextDecision);
      }
      return predicate();
    });
  });

  afterEach(() => {
    mockedCondition.mockReset();
    mockedSetHandler.mockReset();
  });

  it("round-trips an approved result through Temporal's default payload converter", async () => {
    const request: ApprovalRequest = {
      entity_id: "entity-123",
      entity_type: "invoice",
      requested_by: "requester@example.com",
      approvers: ["reviewer@example.com"],
      timeout_hours: 1,
    };
    nextDecision = {
      approved: true,
      decided_by: "reviewer@example.com",
      comments: "Looks good",
    };

    const result = await ApprovalWorkflow(request);
    const payload = defaultPayloadConverter.toPayload(result);

    expect(payload).toBeDefined();
    expect(handlers.has(submitDecisionSignal)).toBe(true);
    expect(handlers.has(getStatusQuery)).toBe(true);
    expect((handlers.get(getStatusQuery) as () => string)()).toBe("approved");

    const roundTripped = defaultPayloadConverter.fromPayload<ApprovalResult>(
      payload as NonNullable<typeof payload>
    );
    expect(roundTripped).toEqual({
      entity_id: "entity-123",
      status: "approved",
      decision: nextDecision,
    });
  });
});

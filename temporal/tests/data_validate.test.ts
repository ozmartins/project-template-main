jest.mock("@temporalio/activity", () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { data_validate } from "../src/activities/data_validate";

const KEY = "test-idempotency-key";

describe("data_validate — pass cases", () => {
  it("returns valid=true with no errors for a conforming object", async () => {
    const result = await data_validate({
      data: { name: "Alice", age: 30 },
      schema: {
        type: "object",
        required: ["name", "age"],
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid=true for a conforming array", async () => {
    const result = await data_validate({
      data: [1, 2, 3],
      schema: { type: "array", items: { type: "number" } },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid=true for a scalar value", async () => {
    const result = await data_validate({
      data: "hello",
      schema: { type: "string" },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("data_validate — fail cases", () => {
  it("returns valid=false with an error when a required field is missing", async () => {
    const result = await data_validate({
      data: { name: "Alice" },
      schema: {
        type: "object",
        required: ["name", "age"],
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/age/);
  });

  it("returns one error per missing required field when multiple fields are absent", async () => {
    const result = await data_validate({
      data: {},
      schema: {
        type: "object",
        required: ["id", "email"],
        properties: {
          id: { type: "string" },
          email: { type: "string" },
        },
      },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((e) => e.includes("id"))).toBe(true);
    expect(result.errors.some((e) => e.includes("email"))).toBe(true);
  });

  it("returns valid=false with an error when a field has the wrong type", async () => {
    const result = await data_validate({
      data: { name: 42 },
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/string/);
  });

  it("returns valid=false when an array item fails the item schema", async () => {
    const result = await data_validate({
      data: ["a", "b", 3],
      schema: { type: "array", items: { type: "string" } },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("does not throw — returns errors array instead", async () => {
    await expect(
      data_validate({
        data: null,
        schema: { type: "object" },
        _idempotency_key: KEY,
      })
    ).resolves.toMatchObject({ valid: false, errors: expect.any(Array) });
  });
});

describe("data_validate — coerce cases", () => {
  it("coerces string to number when coerce=true", async () => {
    const result = await data_validate({
      data: { count: "42" },
      schema: {
        type: "object",
        properties: { count: { type: "number" } },
      },
      coerce: true,
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("coerces string to boolean when coerce=true", async () => {
    const result = await data_validate({
      data: { active: "true" },
      schema: {
        type: "object",
        properties: { active: { type: "boolean" } },
      },
      coerce: true,
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when coerce=false and types do not match", async () => {
    const result = await data_validate({
      data: { count: "42" },
      schema: {
        type: "object",
        properties: { count: { type: "number" } },
      },
      coerce: false,
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

describe("data_validate — rules cases", () => {
  it("returns valid=true with normalized data when all required fields are present", async () => {
    const result = await data_validate({
      data: {
        vendor: "Acme Corp",
        invoice_number: "INV-001",
        invoice_date: "2024-03-15",
        amount: 150.0,
        currency: "usd",
      },
      rules: {
        required_fields: ["vendor", "invoice_number", "invoice_date", "amount", "currency"],
        amount_positive: true,
        date_fields_iso: ["invoice_date"],
        currency_field: "currency",
      },
      throw_on_invalid: false,
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.normalized).toBeDefined();
    expect((result.normalized as Record<string, unknown>).currency).toBe("USD");
  });

  it("throws when a required field (vendor) is missing and throw_on_invalid defaults to true", async () => {
    await expect(
      data_validate({
        data: {
          invoice_number: "INV-001",
          invoice_date: "2024-03-15",
          amount: 150.0,
          currency: "USD",
        },
        rules: {
          required_fields: ["vendor", "invoice_number", "invoice_date", "amount", "currency"],
          amount_positive: true,
        },
        _idempotency_key: KEY,
      })
    ).rejects.toThrow("Missing required field: vendor");
  });

  it("returns valid=false instead of throwing when throw_on_invalid is false", async () => {
    const result = await data_validate({
      data: {
        invoice_number: "INV-001",
        invoice_date: "2024-03-15",
        amount: 150.0,
        currency: "USD",
      },
      rules: {
        required_fields: ["vendor", "invoice_number", "invoice_date", "amount", "currency"],
        amount_positive: true,
      },
      throw_on_invalid: false,
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("vendor"))).toBe(true);
  });

  it("reports all missing required fields at once", async () => {
    const result = await data_validate({
      data: { amount: 50.0 },
      rules: {
        required_fields: ["vendor", "invoice_number", "invoice_date"],
        amount_positive: true,
      },
      throw_on_invalid: false,
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("vendor"))).toBe(true);
    expect(result.errors.some((e) => e.includes("invoice_number"))).toBe(true);
    expect(result.errors.some((e) => e.includes("invoice_date"))).toBe(true);
  });

  it("throws when amount is not positive", async () => {
    await expect(
      data_validate({
        data: { vendor: "Acme", invoice_number: "INV-001", amount: 0, currency: "USD" },
        rules: {
          required_fields: ["vendor", "invoice_number"],
          amount_positive: true,
        },
        _idempotency_key: KEY,
      })
    ).rejects.toThrow("amount must be a positive number");
  });

  it("normalizes ISO date fields in the returned normalized object", async () => {
    const result = await data_validate({
      data: {
        vendor: "Acme",
        invoice_number: "INV-001",
        invoice_date: "2024-03-15T00:00:00Z",
        amount: 100,
        currency: "USD",
      },
      rules: {
        required_fields: ["vendor", "invoice_number", "invoice_date", "amount", "currency"],
        amount_positive: true,
        date_fields_iso: ["invoice_date"],
      },
      throw_on_invalid: false,
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(true);
    expect((result.normalized as Record<string, unknown>).invoice_date).toBe("2024-03-15");
  });
});

describe("data_validate — transform cases", () => {
  it("returns transformed_data mapped from valid input", async () => {
    const result = await data_validate({
      data: { user: { id: "u-1", email: "test@example.com" } },
      schema: { type: "object" },
      transform: {
        user_id: "$.user.id",
        user_email: "$.user.email",
      },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(true);
    expect(result.transformed_data).toEqual({
      user_id: "u-1",
      user_email: "test@example.com",
    });
  });

  it("includes transformed_data even when validation fails", async () => {
    const result = await data_validate({
      data: { user: { id: 123 } },
      schema: {
        type: "object",
        properties: { user: { type: "object", properties: { id: { type: "string" } } } },
      },
      transform: { user_id: "$.user.id" },
      _idempotency_key: KEY,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.transformed_data).toEqual({ user_id: 123 });
  });

  it("omits transformed_data when no transform is provided", async () => {
    const result = await data_validate({
      data: { x: 1 },
      schema: { type: "object" },
      _idempotency_key: KEY,
    });

    expect("transformed_data" in result).toBe(false);
  });
});

import { assertEquals } from "jsr:@std/assert@1";

import { isTriggerableDefinition } from "./index.ts";

Deno.test("allows smoke-classification definition", () => {
  assertEquals(isTriggerableDefinition("smoke-classification"), true);
});

Deno.test("rejects mutating vertical-classification definition", () => {
  assertEquals(isTriggerableDefinition("vertical-classification"), false);
});

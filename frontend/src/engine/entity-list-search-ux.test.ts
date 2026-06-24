import { expect, test } from "vitest";

import { createQueryKey } from "@/data/queryBuilder";
import type { ComponentDefinition, PageDefinition, SupabaseDataSource } from "@/engine/types";
import entityListPage from "@/pages/entity-list.json";
import { createExpressionContext, evaluateExpression } from "./ExpressionEvaluator";

function findComponent(
  node: ComponentDefinition | ComponentDefinition[] | unknown,
  predicate: (component: ComponentDefinition) => boolean
): ComponentDefinition | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const match = findComponent(item, predicate);
      if (match) return match;
    }
    return undefined;
  }

  if (!node || typeof node !== "object") {
    return undefined;
  }

  const component = node as ComponentDefinition;

  if (typeof component.type === "string" && predicate(component)) {
    return component;
  }

  if (Array.isArray(component.children)) {
    const match = findComponent(component.children, predicate);
    if (match) return match;
  }

  return undefined;
}

test("entity list search updates datasource filter working set", () => {
  const page = entityListPage as PageDefinition;
  const entitiesSource = page.dataSources?.entities as SupabaseDataSource;

  const keyWithoutSearch = createQueryKey(
    entitiesSource,
    createExpressionContext({ state: { searchText: "" }, params: { entityType: "portfolio" } })
  );
  const keyWithSearch = createQueryKey(
    entitiesSource,
    createExpressionContext({
      state: { searchText: "searchable" },
      params: { entityType: "portfolio" },
    })
  );

  const evaluatedFilters = keyWithSearch[3] as Array<{ field: string; op: string; value: unknown }>;
  const nameFilter = evaluatedFilters.find(
    (filter) => filter.field === "entity_versions.data->>name" && filter.op === "ilike"
  );

  expect(nameFilter?.value).toBe("%searchable%");
  expect(keyWithSearch).not.toEqual(keyWithoutSearch);
});

test("entity list empty state switches message and clear-search action by search context", () => {
  const page = entityListPage as PageDefinition;

  const emptyMessage = findComponent(
    page.layout,
    (component) =>
      component.type === "Text" &&
      typeof component.props?.children === "string" &&
      component.props.children.includes("No entities match your search")
  );
  const clearSearchButton = findComponent(
    page.layout,
    (component) =>
      component.type === "Button" &&
      component.props?.children === "Clear search" &&
      typeof component.if === "string"
  );

  expect(emptyMessage).toBeDefined();
  expect(clearSearchButton).toBeDefined();

  const emptyContext = createExpressionContext({
    state: { searchText: "" },
    data: { entities: [] },
  });
  const filteredContext = createExpressionContext({
    state: { searchText: "no-match" },
    data: { entities: [] },
  });

  expect(evaluateExpression(emptyMessage?.props?.children, emptyContext)).toBe(
    "No entities found. Create your first one!"
  );
  expect(evaluateExpression(emptyMessage?.props?.children, filteredContext)).toBe(
    "No entities match your search. Clear search or create a new entity."
  );
  expect(Boolean(evaluateExpression(clearSearchButton?.if, emptyContext))).toBe(false);
  expect(Boolean(evaluateExpression(clearSearchButton?.if, filteredContext))).toBe(true);
  expect(clearSearchButton?.props?.onClick).toEqual({
    action: "setState",
    key: "searchText",
    value: "",
  });
});

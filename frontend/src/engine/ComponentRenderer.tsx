/**
 * ComponentRenderer
 *
 * Recursively renders component trees from JSON definitions
 * Handles conditionals (if), loops (each), and expression evaluation
 */

import { getGlobalRegistry } from "@/registry/createRegistry";
import { evaluateExpression, mergeContext, resolveProps } from "./ExpressionEvaluator";
import type { ComponentDefinition, ExpressionContext } from "./types";

interface ComponentRendererProps {
  /** Component definition to render */
  definition: ComponentDefinition;
  /** Expression context */
  context: ExpressionContext;
}

/**
 * ComponentRenderer - Renders a single component and its children
 */
export function ComponentRenderer({ definition, context }: ComponentRendererProps) {
  const registry = getGlobalRegistry();

  // Handle conditional rendering
  if (definition.if !== undefined) {
    const condition = evaluateExpression(definition.if, context);
    if (!condition) {
      return null;
    }
  }

  // Handle list rendering (each)
  if (definition.each !== undefined) {
    const items = evaluateExpression(definition.each, context);

    if (!Array.isArray(items)) {
      return null;
    }

    const itemKey = definition.as || "item";
    const indexKey = definition.indexAs || "index";

    return (
      <>
        {items.map((item, index) => {
          // Create context with item and index
          const itemContext = mergeContext(context, {
            [itemKey]: item,
            [indexKey]: index,
            row: typeof item === "object" ? (item as Record<string, unknown>) : undefined,
            item,
            index,
          } as Partial<ExpressionContext>);

          // Evaluate key for React reconciliation
          const key = definition.key
            ? String(evaluateExpression(definition.key, itemContext))
            : String(index);

          // Create a definition without 'each' to render normally
          const itemDefinition: ComponentDefinition = {
            ...definition,
            each: undefined,
            as: undefined,
            indexAs: undefined,
            key: undefined,
          };

          return <ComponentRenderer key={key} definition={itemDefinition} context={itemContext} />;
        })}
      </>
    );
  }

  // Get the component from registry
  const Component = registry.get(definition.type);

  if (!Component) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 text-red-700 rounded">
        Unknown component: {definition.type}
      </div>
    );
  }

  const resolvedProps = definition.props ? resolveProps(definition.props, context) : {};

  const renderedChildren = definition.children?.length
    ? definition.children.map((child, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: component tree has no stable key
        <ComponentRenderer key={`child-${index}`} definition={child} context={context} />
      ))
    : null;

  const slots = definition.slots
    ? Object.fromEntries(
        Object.entries(definition.slots).map(([slotName, slotContent]) => [
          slotName,
          Array.isArray(slotContent) ? (
            slotContent.map((child, index) => (
              <ComponentRenderer // biome-ignore lint/suspicious/noArrayIndexKey: no stable slot key
                key={`${slotName}-${index}`}
                definition={child}
                context={context}
              />
            ))
          ) : (
            <ComponentRenderer key={slotName} definition={slotContent} context={context} />
          ),
        ])
      )
    : undefined;

  // Render the component
  // Only pass explicit children if we have rendered child components
  // This allows props.children (from expressions) to be used when no child components are defined
  if (renderedChildren) {
    return (
      <Component {...resolvedProps} slots={slots}>
        {renderedChildren}
      </Component>
    );
  }

  return <Component {...resolvedProps} slots={slots} />;
}

/**
 * Render multiple component definitions
 */
export function renderComponents(
  definitions: ComponentDefinition[] | undefined,
  context: ExpressionContext
): React.ReactNode {
  if (!definitions || definitions.length === 0) {
    return null;
  }

  return definitions.map((def, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: component definitions have no stable key
    <ComponentRenderer key={`def-${index}`} definition={def} context={context} />
  ));
}

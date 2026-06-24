/**
 * Component Registry Factory
 *
 * Creates a registry that maps string type names to React components.
 * Components are resolved by type name in JSON definitions.
 */

import type { ComponentRegistry, RegisteredComponent } from "@/engine/types";

/**
 * Create a new component registry
 */
export function createRegistry(
  initialComponents: Record<string, RegisteredComponent> = {}
): ComponentRegistry {
  const components = new Map<string, RegisteredComponent>(Object.entries(initialComponents));

  return {
    get(type: string): RegisteredComponent | undefined {
      return components.get(type);
    },

    register(type: string, component: RegisteredComponent): void {
      components.set(type, component);
    },

    has(type: string): boolean {
      return components.has(type);
    },

    types(): string[] {
      return Array.from(components.keys());
    },
  };
}

/**
 * Global registry instance - will be populated in index.ts
 */
let globalRegistry: ComponentRegistry | null = null;

/**
 * Set the global registry instance
 */
export function setGlobalRegistry(registry: ComponentRegistry): void {
  globalRegistry = registry;
}

/**
 * Get the global registry instance
 */
export function getGlobalRegistry(): ComponentRegistry {
  if (!globalRegistry) {
    throw new Error("Component registry not initialized. Call setGlobalRegistry() first.");
  }
  return globalRegistry;
}

/**
 * Register a component in the global registry
 */
export function registerComponent(type: string, component: RegisteredComponent): void {
  getGlobalRegistry().register(type, component);
}

/**
 * Get a component from the global registry
 */
export function getComponent(type: string): RegisteredComponent | undefined {
  return getGlobalRegistry().get(type);
}

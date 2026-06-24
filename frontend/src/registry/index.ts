/**
 * Default Component Registry
 *
 * Registers all built-in engine components
 */

// Import all engine components
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  Grid,
  Heading,
  Input,
  Link,
  Select,
  Skeleton,
  Stack,
  Text,
  Textarea,
} from "@/components/engine";
import type { ComponentRegistry } from "@/engine/types";
import { createRegistry, setGlobalRegistry } from "./createRegistry";

/**
 * Create and initialize the default component registry
 */
export function createDefaultRegistry(): ComponentRegistry {
  const registry = createRegistry({
    // Layout
    Stack,
    Grid,
    Container,
    Card,

    // Typography
    Text,
    Heading,

    // Forms
    Input,
    Select,
    Checkbox,
    Textarea,

    // Actions
    Button,
    Link,

    // Feedback
    Alert,
    Skeleton,

    // Data
    Badge,
  });

  return registry;
}

/**
 * Initialize the global registry with default components
 */
export function initializeRegistry(): ComponentRegistry {
  const registry = createDefaultRegistry();
  setGlobalRegistry(registry);
  return registry;
}

// Re-export registry utilities
export { getComponent, getGlobalRegistry, registerComponent } from "./createRegistry";

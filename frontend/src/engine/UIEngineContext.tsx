/**
 * UIEngine Context
 *
 * Provides engine state and functions to all child components
 */

import { createContext, useContext } from "react";
import type { UIEngineContextValue } from "./types";

// Default no-op context value
const defaultContext: UIEngineContextValue = {
  state: {},
  setState: () => {},
  data: {},
  params: {},
  isLoading: {},
  errors: {},
  isPageLoading: false,
  dispatch: async () => {},
  refetch: () => {},
  openModals: {},
  openModal: () => {},
  closeModal: () => {},
  evaluateExpression: (expr) => expr,
};

/**
 * UIEngine React context
 */
export const UIEngineContext = createContext<UIEngineContextValue>(defaultContext);

/**
 * Hook to access UIEngine context
 */
export function useUIEngine(): UIEngineContextValue {
  const context = useContext(UIEngineContext);
  if (!context) {
    throw new Error("useUIEngine must be used within a UIEngineProvider");
  }
  return context;
}

/**
 * Hook to access just the dispatch function
 */
export function useDispatch() {
  const { dispatch } = useUIEngine();
  return dispatch;
}

/**
 * Hook to access page state
 */
export function usePageState<T = unknown>(key?: string): T {
  const { state } = useUIEngine();
  if (key) {
    return state[key] as T;
  }
  return state as T;
}

/**
 * Hook to access query data
 */
export function usePageData<T = unknown>(sourceName?: string): T {
  const { data } = useUIEngine();
  if (sourceName) {
    return data[sourceName] as T;
  }
  return data as T;
}

/**
 * Hook to evaluate an expression with current context
 */
export function useExpression<T = unknown>(expression: unknown): T {
  const { evaluateExpression } = useUIEngine();
  return evaluateExpression(expression) as T;
}

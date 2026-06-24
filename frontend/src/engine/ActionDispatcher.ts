/**
 * Action Dispatcher
 *
 * Executes declarative actions defined in JSON page definitions
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import type { UseNavigateResult } from "@tanstack/react-router";
import { evaluateExpression, resolveValue } from "./ExpressionEvaluator";
import type {
  ActionDefinition,
  ApiCallAction,
  CloseModalAction,
  ConditionalAction,
  CustomAction,
  ExpressionContext,
  NavigateAction,
  OpenModalAction,
  RefetchAction,
  SequenceAction,
  SetStateAction,
} from "./types";

/**
 * Custom action handler type
 */
export type CustomActionHandler = (
  payload: unknown,
  context: ExpressionContext
) => Promise<void> | void;

/**
 * Action dispatcher configuration
 */
export interface ActionDispatcherConfig {
  setState: (key: string, value: unknown) => void;
  navigate: UseNavigateResult<string>;
  supabase: SupabaseClient;
  queryClient: QueryClient;
  refetch: (sourceName: string) => void;
  openModal: (modalId: string, props?: Record<string, unknown>) => void;
  closeModal: (modalId?: string) => void;
  customHandlers?: Record<string, CustomActionHandler>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => isRecord(item));
}

/**
 * Create an action dispatcher
 */
export function createActionDispatcher(config: ActionDispatcherConfig) {
  const {
    setState,
    navigate,
    supabase,
    queryClient,
    refetch,
    openModal,
    closeModal,
    customHandlers = {},
  } = config;

  /**
   * Dispatch an action
   */
  async function dispatch(action: ActionDefinition, context: ExpressionContext): Promise<void> {
    switch (action.action) {
      case "setState":
        return handleSetState(action, context);

      case "navigate":
        return handleNavigate(action, context);

      case "apiCall":
        return handleApiCall(action, context);

      case "refetch":
        return handleRefetch(action);

      case "openModal":
        return handleOpenModal(action, context);

      case "closeModal":
        return handleCloseModal(action);

      case "custom":
        return handleCustom(action, context);

      case "sequence":
        return handleSequence(action, context);
      case "conditional":
        return handleConditional(action, context);
    }
  }

  /**
   * Handle setState action
   */
  function handleSetState(action: SetStateAction, context: ExpressionContext): void {
    const value = resolveValue(action.value, context);
    setState(action.key, value);
  }

  /**
   * Handle navigate action
   */
  function handleNavigate(action: NavigateAction, context: ExpressionContext): void {
    const to = evaluateExpression(action.to, context) as string;
    navigate({ to, replace: action.replace });
  }

  /**
   * Handle apiCall action
   */
  async function handleApiCall(action: ApiCallAction, context: ExpressionContext): Promise<void> {
    try {
      const data = resolveValue(action.data, context);
      const match = action.match
        ? (resolveValue(action.match, context) as Record<string, unknown>)
        : undefined;

      let result: { error: unknown } | null;

      switch (action.operation) {
        case "insert":
          if (!action.table) throw new Error("Table required for insert");
          if (!isRecord(data) && !isRecordArray(data)) {
            throw new Error("Insert payload must be an object or object array");
          }
          result = await supabase.from(action.table).insert(data);
          break;

        case "update":
          if (!action.table) throw new Error("Table required for update");
          if (!match) throw new Error("Match criteria required for update");
          if (!isRecord(data)) {
            throw new Error("Update payload must be an object");
          }
          result = await supabase.from(action.table).update(data).match(match);
          break;

        case "upsert":
          if (!action.table) throw new Error("Table required for upsert");
          result = await supabase.from(action.table).upsert(data as Record<string, unknown>[]);
          break;

        case "delete":
          if (!action.table) throw new Error("Table required for delete");
          if (!match) throw new Error("Match criteria required for delete");
          result = await supabase.from(action.table).delete().match(match);
          break;

        case "rpc":
          if (!action.function) throw new Error("Function name required for rpc");
          result = await supabase.rpc(action.function, data as Record<string, unknown>);
          break;

        default:
          throw new Error(`Unknown API operation: ${action.operation}`);
      }

      if (result.error) {
        throw result.error;
      }

      // Invalidate queries for this table
      if (action.table) {
        queryClient.invalidateQueries({ queryKey: ["supabase", action.table] });
        queryClient.invalidateQueries({ queryKey: ["datasource"] });
      }

      // Execute onSuccess action
      if (action.onSuccess) {
        await dispatch(action.onSuccess, context);
      }
    } catch (error) {
      // Execute onError action
      if (action.onError) {
        await dispatch(action.onError, {
          ...context,
          event: { error },
        });
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle refetch action
   */
  function handleRefetch(action: RefetchAction): void {
    refetch(action.source);
  }

  /**
   * Handle openModal action
   */
  function handleOpenModal(action: OpenModalAction, context: ExpressionContext): void {
    const props = action.props
      ? (resolveValue(action.props, context) as Record<string, unknown>)
      : undefined;
    openModal(action.modalId, props);
  }

  /**
   * Handle closeModal action
   */
  function handleCloseModal(action: CloseModalAction): void {
    closeModal(action.modalId);
  }

  /**
   * Handle custom action
   */
  async function handleCustom(action: CustomAction, context: ExpressionContext): Promise<void> {
    const handler = customHandlers[action.handler];

    if (!handler) {
      return;
    }

    const payload = action.payload ? resolveValue(action.payload, context) : undefined;

    await handler(payload, context);
  }

  /**
   * Handle sequence action (run multiple actions in order)
   */
  async function handleSequence(action: SequenceAction, context: ExpressionContext): Promise<void> {
    for (const subAction of action.actions) {
      await dispatch(subAction, context);
    }
  }

  /**
   * Handle conditional action
   */
  async function handleConditional(
    action: ConditionalAction,
    context: ExpressionContext
  ): Promise<void> {
    const condition = evaluateExpression(action.condition, context);

    if (condition) {
      await dispatch(action.then, context);
    } else if (action.else) {
      await dispatch(action.else, context);
    }
  }

  return { dispatch };
}

/**
 * Type for the dispatcher function
 */
export type ActionDispatch = (
  action: ActionDefinition,
  additionalContext?: Partial<ExpressionContext>
) => Promise<void>;

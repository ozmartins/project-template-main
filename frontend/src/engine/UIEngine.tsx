/**
 * UIEngine Component
 *
 * Main orchestrator that interprets page definitions and renders component trees
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { get } from "lodash-es";
import { useCallback, useMemo, useState } from "react";
import { useAuthCapabilities } from "@/auth";
import { supabase } from "@/data/supabase";
import { createActionDispatcher } from "./ActionDispatcher";
import { ComponentRenderer } from "./ComponentRenderer";
import { createExpressionContext, evaluateExpression, mergeContext } from "./ExpressionEvaluator";
import type {
  ActionDefinition,
  ComputedDataSource,
  ExpressionContext,
  PageDefinition,
  UIEngineContextValue,
} from "./types";
import { UIEngineContext } from "./UIEngineContext";
import { useDataSources } from "./useDataSources";

interface UIEngineProps {
  /** The page definition to render */
  page: PageDefinition;
  /** Route parameters */
  params?: Record<string, string>;
}

/**
 * UIEngine - Interprets JSON page definitions and renders component trees
 */
export function UIEngine({ page, params = {} }: UIEngineProps) {
  // Initialize page state
  const [state, setStateInternal] = useState<Record<string, unknown>>(() => page.state || {});

  // Modal state
  const [openModals, setOpenModals] = useState<Record<string, { props?: Record<string, unknown> }>>(
    {}
  );

  // Router navigation
  const navigate = useNavigate();

  // Query client for cache invalidation
  const queryClient = useQueryClient();

  // Auth capabilities — injected into expression context as `auth`
  const auth = useAuthCapabilities();

  // Create base expression context
  const baseContext = useMemo<ExpressionContext>(
    () =>
      createExpressionContext({
        state,
        params,
        auth: auth as unknown as Record<string, unknown>,
      }),
    [state, params, auth]
  );

  // Fetch data sources
  const { data, isLoading, errors, isPageLoading, refetch } = useDataSources(
    page.dataSources,
    baseContext
  );

  // Full context with data (used for expression evaluation including computed sources)
  const fullContext = useMemo<ExpressionContext>(
    () =>
      mergeContext(baseContext, {
        data,
      }),
    [baseContext, data]
  );

  // Derive computed data sources (client-side derived from other sources)
  const allData = useMemo(() => {
    const result: Record<string, unknown> = { ...data };
    for (const [key, source] of Object.entries(page.dataSources || {})) {
      if (source.type !== "computed") continue;
      const computed = source as ComputedDataSource;
      // Guard: source must resolve to an actual array
      const raw = data[computed.from];
      const baseArray: unknown[] = Array.isArray(raw) ? raw : [];
      if (!computed.search) {
        result[key] = baseArray;
        continue;
      }
      const computedSearch = computed.search;
      const query = String(evaluateExpression(computedSearch.query, fullContext) ?? "")
        .toLowerCase()
        .trim();
      if (!query) {
        result[key] = baseArray;
      } else {
        result[key] = baseArray.filter((item) =>
          computedSearch.fields.some((field) => {
            const fieldValue =
              typeof item === "object" && item !== null
                ? get(item as Record<string, unknown>, field)
                : undefined;
            return String(fieldValue ?? "")
              .toLowerCase()
              .includes(query);
          })
        );
      }
    }
    return result;
  }, [data, page.dataSources, fullContext]);

  // Render context uses allData so computed sources are visible to components
  const renderContext = useMemo<ExpressionContext>(
    () => mergeContext(baseContext, { data: allData }),
    [baseContext, allData]
  );

  // State setter
  const setState = useCallback((key: string, value: unknown) => {
    setStateInternal((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  // Modal handlers
  const openModal = useCallback((modalId: string, props?: Record<string, unknown>) => {
    setOpenModals((prev) => ({
      ...prev,
      [modalId]: { props },
    }));
  }, []);

  const closeModal = useCallback((modalId?: string) => {
    if (modalId) {
      setOpenModals((prev) => {
        const next = { ...prev };
        delete next[modalId];
        return next;
      });
    } else {
      setOpenModals({});
    }
  }, []);

  // Create action dispatcher
  const actionDispatcher = useMemo(
    () =>
      createActionDispatcher({
        setState,
        navigate,
        supabase,
        queryClient,
        refetch,
        openModal,
        closeModal,
      }),
    [setState, navigate, queryClient, refetch, openModal, closeModal]
  );

  // Dispatch function that merges contexts
  const dispatch = useCallback(
    async (action: ActionDefinition, additionalContext?: Partial<ExpressionContext>) => {
      const context = additionalContext
        ? mergeContext(renderContext, additionalContext)
        : renderContext;
      await actionDispatcher.dispatch(action, context);
    },
    [actionDispatcher, renderContext]
  );

  // Expression evaluator for child components
  const evalExpression = useCallback(
    (expr: unknown, additionalContext?: Partial<ExpressionContext>) => {
      const context = additionalContext
        ? mergeContext(renderContext, additionalContext)
        : renderContext;
      return evaluateExpression(expr, context);
    },
    [renderContext]
  );

  // Build context value
  const contextValue = useMemo<UIEngineContextValue>(
    () => ({
      state,
      setState,
      data: allData,
      params,
      isLoading,
      errors,
      isPageLoading,
      dispatch,
      refetch,
      openModals,
      openModal,
      closeModal,
      evaluateExpression: evalExpression,
    }),
    [
      state,
      setState,
      allData,
      params,
      isLoading,
      errors,
      isPageLoading,
      dispatch,
      refetch,
      openModals,
      openModal,
      closeModal,
      evalExpression,
    ]
  );

  return (
    <UIEngineContext.Provider value={contextValue}>
      {/* Render main layout */}
      <ComponentRenderer definition={page.layout} context={renderContext} />

      {/* Render modals */}
      {page.modals &&
        Object.entries(openModals).map(([modalId, modalState]) => {
          const modalDef = page.modals?.[modalId];
          if (!modalDef) return null;

          // Create context with modal props
          const modalContext = mergeContext(renderContext, {
            state: { ...state, ...(modalState.props || {}) },
          });

          return (
            <ModalRenderer
              key={modalId}
              modalId={modalId}
              definition={modalDef}
              context={modalContext}
              onClose={() => closeModal(modalId)}
            />
          );
        })}
    </UIEngineContext.Provider>
  );
}

/**
 * Modal Renderer Component
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ModalDefinition } from "./types";

interface ModalRendererProps {
  modalId: string;
  definition: ModalDefinition;
  context: ExpressionContext;
  onClose: () => void;
}

function ModalRenderer({ definition, context, onClose }: ModalRendererProps) {
  const title = definition.title
    ? (evaluateExpression(definition.title, context) as string)
    : undefined;

  const description = definition.description
    ? (evaluateExpression(definition.description, context) as string)
    : undefined;

  const sizeClasses: Record<string, string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-full",
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={sizeClasses[definition.size || "md"]}>
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        <ComponentRenderer definition={definition.content} context={context} />
      </DialogContent>
    </Dialog>
  );
}

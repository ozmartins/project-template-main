/**
 * JSON-Driven UI Engine Type Definitions
 */

// ============================================================================
// PAGE DEFINITION
// ============================================================================

/**
 * Complete page definition - the top-level JSON structure
 */
export interface PageDefinition {
  /** Unique identifier for the page */
  id: string;
  /** Page title (can contain expressions) */
  title: string;
  /** Optional description */
  description?: string;
  /** Initial state values for the page */
  state?: Record<string, unknown>;
  /** Data sources to fetch */
  dataSources?: Record<string, DataSourceDefinition>;
  /** Component tree defining the page layout */
  layout: ComponentDefinition;
  /** Modal definitions for this page */
  modals?: Record<string, ModalDefinition>;
  /** Page-level metadata */
  meta?: PageMeta;
}

/**
 * Page metadata for routing and permissions
 */
export interface PageMeta {
  requiresAuth?: boolean;
  permissions?: string[];
  breadcrumb?: string;
}

// ============================================================================
// COMPONENT DEFINITION
// ============================================================================

/**
 * Definition for a single component in the component tree
 */
export interface ComponentDefinition {
  /** Component type - maps to registry key (e.g., "Card", "Button", "Stack") */
  type: string;
  /** Props to pass to the component (may contain {{expressions}}) */
  props?: Record<string, unknown>;
  /** Child components */
  children?: ComponentDefinition[];

  // Conditional rendering
  /** Expression that must be truthy for component to render */
  if?: string;

  // List rendering
  /** Expression returning array to iterate over */
  each?: string;
  /** Variable name for current item (default: "item") */
  as?: string;
  /** Variable name for current index (default: "index") */
  indexAs?: string;

  // Slots for complex layouts
  /** Named slots for components like Tabs */
  slots?: Record<string, ComponentDefinition | ComponentDefinition[]>;

  /** Key for React reconciliation (expression) */
  key?: string;
}

// ============================================================================
// DATA SOURCE DEFINITIONS
// ============================================================================

export type DataSourceDefinition =
  | SupabaseDataSource
  | ApiDataSource
  | StaticDataSource
  | ComputedDataSource;

/**
 * Supabase query data source
 */
export interface SupabaseDataSource {
  type: "supabase";
  /** Table name */
  table: string;
  /** Column selection (default: "*") */
  select?: string;
  /** Filters to apply */
  filters?: FilterDefinition[];
  /** Ordering */
  order?: OrderDefinition[];
  /** Limit results */
  limit?: number;
  /** Expect single row (uses .single()) */
  single?: boolean;
  /** Expression - only fetch when truthy */
  enabled?: string;
  /** State keys that trigger refetch */
  refetchOn?: string[];
}

/**
 * Filter definition for Supabase queries
 */
export interface FilterDefinition {
  field: string;
  op:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "like"
    | "ilike"
    | "in"
    | "is"
    | "contains"
    | "containedBy";
  /** Value can be an expression */
  value: unknown;
}

/**
 * Order definition for Supabase queries
 */
export interface OrderDefinition {
  column: string;
  ascending?: boolean;
}

/**
 * API fetch data source
 */
export interface ApiDataSource {
  type: "api";
  /** URL (can contain expressions) */
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  enabled?: string;
  refetchOn?: string[];
}

/**
 * Static data source (no fetching)
 */
export interface StaticDataSource {
  type: "static";
  data: unknown;
}

/**
 * Computed (client-side derived) data source.
 * Derives its data from another data source by applying client-side filtering.
 * Evaluated after network data sources are fetched, using current page state.
 */
export interface ComputedDataSource {
  type: "computed";
  /** Name of the source data source to derive from */
  from: string;
  /** Client-side search filter */
  search?: {
    /**
     * Field paths to search within, using lodash dot/bracket notation.
     * e.g. ["entity_versions[0].data.name", "entity_versions[0].data.description"]
     */
    fields: string[];
    /** Expression evaluating to the search query string */
    query: string;
  };
}

// ============================================================================
// ACTION DEFINITIONS
// ============================================================================

export type ActionDefinition =
  | SetStateAction
  | NavigateAction
  | ApiCallAction
  | RefetchAction
  | OpenModalAction
  | CloseModalAction
  | CustomAction
  | SequenceAction
  | ConditionalAction;

/**
 * Update page state
 */
export interface SetStateAction {
  action: "setState";
  /** State key to update */
  key: string;
  /** Value (can be expression) */
  value: unknown;
}

/**
 * Navigate to another route
 */
export interface NavigateAction {
  action: "navigate";
  /** Route path (can contain expressions) */
  to: string;
  /** Replace current history entry */
  replace?: boolean;
}

/**
 * Call Supabase API
 */
export interface ApiCallAction {
  action: "apiCall";
  operation: "insert" | "update" | "upsert" | "delete" | "rpc";
  /** Table for CRUD operations */
  table?: string;
  /** Function name for RPC */
  function?: string;
  /** Data payload (expression) */
  data?: unknown;
  /** Match criteria for update/delete */
  match?: Record<string, unknown>;
  /** Action to run on success */
  onSuccess?: ActionDefinition;
  /** Action to run on error */
  onError?: ActionDefinition;
}

/**
 * Refetch a data source
 */
export interface RefetchAction {
  action: "refetch";
  /** Data source name to refetch */
  source: string;
}

/**
 * Open a modal
 */
export interface OpenModalAction {
  action: "openModal";
  /** Modal ID to open */
  modalId: string;
  /** Props to pass to modal */
  props?: Record<string, unknown>;
}

/**
 * Close modal(s)
 */
export interface CloseModalAction {
  action: "closeModal";
  /** Specific modal to close (all if omitted) */
  modalId?: string;
}

/**
 * Call a custom registered action handler
 */
export interface CustomAction {
  action: "custom";
  /** Registered handler name */
  handler: string;
  /** Payload to pass */
  payload?: unknown;
}

/**
 * Run multiple actions in sequence
 */
export interface SequenceAction {
  action: "sequence";
  actions: ActionDefinition[];
}

/**
 * Conditional action execution
 */
export interface ConditionalAction {
  action: "conditional";
  /** Condition expression */
  condition: string;
  /** Action if condition is truthy */
  then: ActionDefinition;
  /** Action if condition is falsy */
  else?: ActionDefinition;
}

// ============================================================================
// MODAL DEFINITION
// ============================================================================

/**
 * Modal/dialog definition
 */
export interface ModalDefinition {
  /** Modal title (expression) */
  title?: string;
  /** Modal description (expression) */
  description?: string;
  /** Modal size */
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** Modal content component tree */
  content: ComponentDefinition;
}

// ============================================================================
// EXPRESSION CONTEXT
// ============================================================================

/**
 * Context available for expression evaluation
 */
export interface ExpressionContext {
  /** Page state */
  state: Record<string, unknown>;
  /** Query results */
  data: Record<string, unknown>;
  /** Route parameters */
  params: Record<string, string>;
  /** Event object (in action handlers) */
  event?: unknown;
  /** Current row context (in tables) */
  row?: Record<string, unknown>;
  /** Current item context (in iterations) */
  item?: unknown;
  /** Current index (in iterations) */
  index?: number;
  /** Form data context */
  form?: Record<string, unknown>;
  /** Dynamic keys for custom iteration variables (e.g., "entity", "user") */
  [key: string]: unknown;
}

// ============================================================================
// ENGINE CONTEXT
// ============================================================================

/**
 * Context provided by UIEngine to all children
 */
export interface UIEngineContextValue {
  /** Current page state */
  state: Record<string, unknown>;
  /** Update state */
  setState: (key: string, value: unknown) => void;
  /** Query results by source name */
  data: Record<string, unknown>;
  /** Route parameters */
  params: Record<string, string>;
  /** Loading state by source name */
  isLoading: Record<string, boolean>;
  /** Error state by source name */
  errors: Record<string, Error | null>;
  /** Global loading state */
  isPageLoading: boolean;
  /** Dispatch an action */
  dispatch: (action: ActionDefinition, eventContext?: Partial<ExpressionContext>) => Promise<void>;
  /** Refetch a specific data source */
  refetch: (sourceName: string) => void;
  /** Open modals */
  openModals: Record<string, { props?: Record<string, unknown> }>;
  /** Open a modal */
  openModal: (modalId: string, props?: Record<string, unknown>) => void;
  /** Close a modal */
  closeModal: (modalId?: string) => void;
  /** Evaluate an expression */
  evaluateExpression: (expr: unknown, additionalContext?: Partial<ExpressionContext>) => unknown;
}

// ============================================================================
// COMPONENT REGISTRY
// ============================================================================

/**
 * Props passed to engine components
 */
export interface EngineComponentProps {
  /** Resolved props (expressions already evaluated) */
  [key: string]: unknown;
  /** Children rendered by ComponentRenderer */
  children?: React.ReactNode;
}

/**
 * Component type in the registry
 */
export type RegisteredComponent = React.ComponentType<EngineComponentProps>;

/**
 * Component registry interface
 */
export interface ComponentRegistry {
  /** Get a component by type name */
  get(type: string): RegisteredComponent | undefined;
  /** Register a new component */
  register(type: string, component: RegisteredComponent): void;
  /** Check if a component is registered */
  has(type: string): boolean;
  /** Get all registered type names */
  types(): string[];
}

// ============================================================================
// COLUMN DEFINITION (for DataTable)
// ============================================================================

/**
 * Column definition for DataTable component
 */
export interface ColumnDefinition {
  /** Field path (supports dot notation) */
  field: string;
  /** Column header text */
  header: string;
  /** Column width (CSS value) */
  width?: string;
  /** Whether column is sortable */
  sortable?: boolean;
  /** Format type */
  format?: "date" | "datetime" | "relative" | "currency" | "number";
  /** Custom renderer component type */
  renderer?: string;
}

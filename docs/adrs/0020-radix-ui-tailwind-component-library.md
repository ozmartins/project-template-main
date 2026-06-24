# ADR-0020: Radix UI + Tailwind CSS as the Component Foundation

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The frontend engine (ADR-0018) needs a component registry of reusable UI primitives. These components must be accessible by default (keyboard navigation, screen reader semantics, ARIA patterns), styleable without fighting existing CSS, and expressible as plain props from a JSON definition — no render prop patterns or complex HOC structures.

## Decision

Component primitives are built on **[Radix UI](https://www.radix-ui.com/)** (headless, unstyled, accessible) with **[Tailwind CSS](https://tailwindcss.com/) v4** for styling.

- **Radix UI** provides the behaviour layer: dialogs, dropdowns, popovers, select menus, tabs, tooltips, checkboxes. All accessibility requirements (focus management, ARIA attributes, keyboard navigation) are handled by Radix with no custom code.
- **Tailwind** provides the styling layer. All styles are utility classes — no CSS modules, no styled-components, no runtime CSS-in-JS. Tailwind v4 uses a Vite plugin; no `tailwind.config.js` required for basic use.
- **Lucide React** for icons — consistent, tree-shakeable SVG icon set.
- **No component library package** (no Material UI, Chakra, shadcn/ui distribution). Components are authored directly in `frontend/src/registry/`, owned by this project.

This combination is the technical foundation of [shadcn/ui](https://ui.shadcn.com/) — the same Radix + Tailwind pairing but without taking a dependency on shadcn's distribution. Components are copy-owned, not package-managed.

## Consequences

**Positive:**
- Accessibility is Radix's responsibility, not the application's. Complex patterns (focus trapping in dialogs, ARIA live regions in comboboxes) are correct by default.
- Tailwind utility classes are JSON-friendly — a component's `className` prop can be a plain string in a page definition, expressible without code.
- No CSS specificity conflicts. Tailwind generates atomic classes; no global stylesheets to fight.
- Components are owned and versioned in this repo. There is no external breaking-change risk from a component library's major version.

**Negative:**
- Radix components are unstyled out of the box. Every component in the registry must have deliberate styling applied. The initial component set requires more up-front design work than a fully styled library.
- Tailwind utility class strings can become long and hard to read for complex components. This is a code review concern, not a functional one.
- Not using shadcn/ui's distribution means we do not get free access to the full shadcn component catalogue. New component types must be built from Radix primitives manually.
- Tailwind v4 is a major version with breaking changes from v3. The Vite plugin replaces the PostCSS config; engineers familiar with v3 must adjust.

## Alternatives considered

**Material UI (MUI):** Full styled library with strong accessibility. Heavy bundle; opinionated visual design that requires significant effort to override; CSS-in-JS runtime cost.

**shadcn/ui (as a distribution):** Radix + Tailwind — same foundation. shadcn components are added via CLI (`npx shadcn@latest add button`) which copies source into the project — effectively the same as owning the components. The choice is equivalent; this project skips the shadcn CLI to avoid that toolchain dependency.

**Chakra UI:** Good accessibility but requires a theme provider and CSS-in-JS runtime. More configuration overhead for a template.

## Evidence

- `frontend/package.json` — `@radix-ui/*`, `tailwindcss`, `lucide-react`
- `frontend/src/registry/` — component registry built on these primitives
- `frontend/vite.config.ts` — `@tailwindcss/vite` plugin

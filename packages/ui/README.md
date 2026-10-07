# Shared UI components

These components were generated from the official shadcn/ui `new-york-v4` registry with `shadcn` CLI 3.8.5 on 2026-10-06. Project config: `components.json`; Tailwind 4.3.3 and `@tailwindcss/vite` 4.3.3. Generated files: `src/components/{badge,button,card,dialog,input,label,select,tabs,textarea}.tsx`.

Local changes (2026-10-07): `select.tsx` and `dialog.tsx` import their check/chevron/close icons from `src/icons.tsx` instead of `lucide-react`; component behavior and Radix structure remain upstream. The DBPilot color tokens live in `src/theme.css`; the Web entry imports that theme and Tailwind. Future component updates should compare generated source and preserve local changes deliberately.

`packages/workbench/src/Workbench.tsx` consumes the shared components. The Electron Renderer uses the same Web bundle. The SQL editor uses Monaco, and the data grid uses TanStack Table/Virtual. The current theme is neutral black and white in `src/theme.css`.

## Shared icons

`src/icons.tsx` uses `@iconify/react` 6.0.2 (MIT), its `/offline` renderer, and individual icon data imports from `@iconify-icons/lucide` 2.0.16 (ISC). Sources: [Iconify React](https://iconify.design/docs/icon-components/react/) and the installed packages' license files. Only explicitly imported icons enter the frontend bundle. There are no Iconify API/CDN calls, which keeps Web and Electron icons available offline without changing CSP network permissions.

Use `<AppIcon name="database" />` for product icons. Default size is 16px; tree icons use 12–17px and context/empty-state icons 19–28px. Icons use `currentColor`, are non-focusable and hidden from assistive technology; visible button text or an `aria-label` must name the action. Busy indicators honor reduced-motion preferences. Do not add raw Unicode glyphs or a second icon renderer for new controls.

`apps/web/public/favicon.svg` reuses the same Lucide `database-zap` path, with a local blue rounded background. The icon's ISC license also applies to this derived asset. This is the browser tab icon; the native installer icon has not yet been designed.

## Global notifications and control states (2026-10-07)

`src/components/sonner.tsx` adapts the official [shadcn new-york-v4 Sonner registry](https://ui.shadcn.com/r/styles/new-york-v4/sonner.json), fetched on 2026-10-07, with installed `sonner` 2.0.8 (MIT). CLI3.8.5 registry resolution succeeded but its hidden dependency install stalled; a direct pnpm install using IPv4 completed. Local changes replace lucide-react with shared offline Iconify icons and next-themes with the current shared light theme, render via a body Portal, localize accessible labels, and configure a fixed bottom-right notification stack above modal/select portals. `src/notify.ts` centralizes success/error/warning duration and stable IDs. Do not render a second Toaster inside a dialog.

Operational feedback uses the global notification stack. Form input validation remains alongside fields. Execution history, log records, partial-result state and approval details remain persistent evidence; they are not replaced by transient notifications.

Local shared-component changes: Select defaults to an anchored popper with bounded collision padding, no trigger shadow, and explicit keyboard outline; line tabs use a single underline without border/background/shadow or cross-fade overlap; Button outline variants have no shadow and use a thin keyboard-only outline. Dialog ignores interactions originating in the notification portal so closing a toast does not dismiss the dialog. Keyboard focus remains visible. Workbench CSS supplies compact 28px AI preferences and smaller dropdown typography; ordinary form controls keep their usable size.

The notification portal also stops pointer/click bubbling at its own boundary, keeping Radix deferred outside-click handling separate from toast controls. SQLite filename labels use an explicit `htmlFor`/`id` association so the Desktop “浏览” button does not become part of the input's accessible name.

Dialog local addition (2026-10-07): `placement="right"` reuses the installed shadcn/Radix primitive as an edge drawer. The policy editor uses a full-height right panel with a scrolling rules region and fixed action footer. Focus trap, Escape, title/description and trigger focus restoration continue through Radix; no additional modal library is introduced.

Agent Markdown uses react-markdown 10.1.0 (https://github.com/remarkjs/react-markdown) with remark-gfm 4.0.1. The local wrapper disables raw HTML and remote images, permits only HTTP(S) links, and uses the existing shadcn Button for copying complete code blocks. It does not execute rendered code. Styling is shared in the workbench stylesheet.

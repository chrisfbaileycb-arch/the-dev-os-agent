// The four colour palettes, and the one place that knows how to switch between them.
//
// Until now the app had exactly one palette, painted with custom properties in :root and flipped
// to a dark variant by `prefers-color-scheme`. That is a good default and a bad ceiling: the
// visitor cannot keep the darker one at noon or the lighter one at midnight, and there is no way
// at all to ask for a warm reading surface. So the palette becomes an explicit choice with four
// answers, each a complete set of the same variables:
//
//   sand    warm tan and clay — a paper-ish reading surface, low glare under a desk lamp
//   pastel  cool lavender and mint — soft, higher contrast than sand, still not white
//   light   off-white and ink — the plain standard surface, no tint
//   dark    deep navy and slate — the original dark variant, now selectable rather than inferred
//
// The mechanism is one attribute, `data-theme` on <html>, and four rule blocks in styles.css that
// set the same custom properties. Nothing else in the app reads a theme: every component already
// paints itself from `var(--…)`, so a new palette is a CSS block and an entry in this list, and no
// component has a conditional anywhere. That property is the reason this file exists as a plain
// list rather than as inline styles threaded through the tree.
//
// `system` is not one of the four choices. It is the absence of a choice: the attribute is removed
// and the stylesheet's own `prefers-color-scheme` rules decide, which is what the app did before
// and stays the default for a visitor who never opens the picker.

import type { LucideIcon } from 'lucide-react';
import { Moon, Palette, Coffee, Leaf, Sun } from 'lucide-react';

/** The stored value: one of the four palettes, or 'system' to defer to the OS. */
export type ThemeChoice = 'system' | 'sand' | 'pastel' | 'light' | 'dark';

export interface ThemeOption {
  id: Exclude<ThemeChoice, 'system'>;
  label: string;
  blurb: string;
  icon: LucideIcon;
  /** The colour the swatch is drawn in, so the picker previews the palette it names. */
  swatch: [string, string, string];
}

/**
 * The four palettes, in the order they are offered.
 *
 * Sand first because it is the one a visitor is least likely to have, and the point of the picker
 * is that it is there at all. Dark last because it is the one everyone already had.
 */
export const THEMES: ThemeOption[] = [
  { id: 'sand', label: 'Sand', blurb: 'Warm tan and clay. A paper-like surface that is easy on the eyes.', icon: Coffee, swatch: ['#f3ead9', '#e2c9a0', '#8a4b2a'] },
  { id: 'pastel', label: 'Pastel', blurb: 'Lavender and mint. Gentle, cooler than sand, still tinted.', icon: Leaf, swatch: ['#f6f4fd', '#d9d2f5', '#6b5cd6'] },
  { id: 'light', label: 'Light', blurb: 'Off-white and ink. The plain standard surface, no tint.', icon: Sun, swatch: ['#f7f7f8', '#e4e4e7', '#18181b'] },
  { id: 'dark', label: 'Dark', blurb: 'Deep navy and slate. The classic dark developer surface.', icon: Moon, swatch: ['#0f1220', '#262b3f', '#ff8a7e'] },
];

const STORAGE_KEY = 'hb-theme';
const VALID = new Set<string>([...THEMES.map(t => t.id), 'system']);

/** Whether a stored or supplied value is a theme this build knows about. */
export const isThemeChoice = (value: unknown): value is ThemeChoice => typeof value === 'string' && VALID.has(value);

/** The visitor's stored choice, or 'system' when nothing valid is stored. */
export function loadTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemeChoice(raw) ? raw : 'system';
  } catch { return 'system'; }
}

/**
 * Paint a choice onto the document.
 *
 * One attribute write, and `system` is a removal rather than a value: the stylesheet can then own
 * the light/dark media query exactly as it did before, with no fifth set of variables to keep in
 * sync. The `<meta name="theme-color">` is updated too so the browser chrome of an installed PWA
 * matches the surface behind it instead of staying the dark navy it was built with.
 */
export function applyTheme(choice: ThemeChoice, doc: Document = document): void {
  const root = doc.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', TINT[choice === 'system' ? 'system-light' : choice]);
}

/** Persist a choice and paint it. An unknown value is refused rather than stored and ignored. */
export function saveTheme(choice: ThemeChoice): boolean {
  if (!isThemeChoice(choice)) return false;
  try { localStorage.setItem(STORAGE_KEY, choice); } catch { /* storage unavailable: the choice still applies to this tab */ }
  applyTheme(choice);
  return true;
}

/**
 * The browser-chrome colour for each palette, and for the two the media query can resolve to.
 *
 * These are the `--panel` values of the corresponding stylesheet block, duplicated here because
 * a meta tag takes a literal colour and cannot read a custom property. Kept adjacent to the
 * palettes above so a change to one is obviously a change to the other.
 */
const TINT: Record<string, string> = {
  sand: '#fbf5e9',
  pastel: '#ffffff',
  light: '#ffffff',
  dark: '#161a2b',
  'system-light': '#ffffff',
};

/** Whether the OS currently prefers a dark surface, for the swatch shown beside "System". */
export const prefersDark = (win: Window = window): boolean =>
  typeof win.matchMedia === 'function' && win.matchMedia('(prefers-color-scheme: dark)').matches;

export { Palette };

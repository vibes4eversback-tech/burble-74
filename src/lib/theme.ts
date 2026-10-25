export type ThemeId = 'glass' | 'midnight' | 'aurora' | 'sunset';

export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'glass', label: 'Glass White', swatch: 'linear-gradient(135deg,#ffffff,#dfe7f5)' },
  { id: 'midnight', label: 'Midnight', swatch: 'linear-gradient(135deg,#1b1f3b,#0b0d1a)' },
  { id: 'aurora', label: 'Aurora', swatch: 'linear-gradient(135deg,#7ef0d0,#7aa8ff,#c59bff)' },
  { id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg,#ffc3a0,#ff7eb3)' },
];

const KEY = 'burble.theme';

export function loadTheme(): ThemeId {
  const v = localStorage.getItem(KEY) as ThemeId | null;
  return THEMES.some((t) => t.id === v) ? (v as ThemeId) : 'glass';
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  localStorage.setItem(KEY, id);
}

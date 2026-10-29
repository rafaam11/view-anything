const paths = {
  previous: '<path d="m15 5-7 7 7 7"/>', next: '<path d="m9 5 7 7-7 7"/>',
  plus: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6m-3-3v6"/>',
  minus: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  edit: '<path d="m4 16 12-12 4 4L8 20H4Z"/>',
  rotate: '<path d="M4 9a8 8 0 1 1 0 7M4 3v6h6"/>',
  flip: '<path d="M12 2v20M3 6l5 6-5 6Zm18 0-5 6 5 6Z"/>',
  crop: '<path d="M6 2v16h16M2 6h16v16"/>',
  save: '<path d="M4 3h13l4 4v14H3V3Zm3 0v6h9V3M7 21v-7h10v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
} as const;
export function iconButton(label: string, icon: keyof typeof paths, shortcut?: string): HTMLButtonElement {
  const b = document.createElement("button"); b.type = "button"; b.className = "va-icon-button";
  b.title = shortcut ? `${label} (${shortcut})` : label; b.setAttribute("aria-label", label);
  if (shortcut) b.setAttribute("aria-keyshortcuts", shortcut);
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[icon]}</svg>`;
  return b;
}

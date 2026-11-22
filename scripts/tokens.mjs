import { readFile, writeFile } from 'node:fs/promises';

const file = (path) => new URL(`../${path}`, import.meta.url);
const tokens = JSON.parse(await readFile(file('design/tokens.json'), 'utf8'));
const declare = (entries) => Object.entries(entries).map(([name, value]) => `  --${name}: ${value};`).join('\n');
const prefix = (group, entries) =>
  Object.fromEntries(Object.entries(entries).map(([name, value]) => [`${group}-${name}`, value]));
const colors = (format) =>
  prefix('color', Object.fromEntries(Object.entries(tokens.colors).map(([name, value]) => [name, value[format]])));
const theme = (name) => Object.fromEntries(
  Object.entries(tokens.themes[name]).map(([role, color]) => [role, `var(--color-${color})`]),
);

export const variables = `/* Generated from design/tokens.json by npm run tokens. */
:root {
${declare({
  ...colors('hex'),
  ...theme('dark'),
  ...prefix('space', tokens.spacing),
  ...prefix('radius', tokens.radius),
  ...prefix('type', tokens.type),
  ...prefix('elevation', tokens.elevation),
  ...prefix('motion', tokens.motion),
})}
}
:root[data-theme="light"] {
${declare(theme('light'))}
}
@supports (color: oklch(0.5 0.1 90)) {
  :root {
${declare(colors('oklch')).replace(/^/gm, '  ')}
  }
}
`;

export const tailwind = `/* Tailwind CSS v4 theme. Load tokens.css before this file. */
@theme inline {
${declare({
  ...Object.fromEntries(Object.keys(tokens.themes.dark).map((name) => [`color-${name}`, `var(--${name})`])),
  'font-sans': 'var(--type-sans)',
  'font-mono': 'var(--type-mono)',
  ...Object.fromEntries(['display', 'heading', 'body', 'label'].map((name) => [`text-${name}`, `var(--type-${name})`])),
  ...prefix('spacing', Object.fromEntries(Object.keys(tokens.spacing).map((name) => [name, `var(--space-${name})`]))),
  ...prefix('shadow', Object.fromEntries(Object.keys(tokens.elevation).map((name) => [name, `var(--elevation-${name})`]))),
  ...prefix('radius', tokens.radius),
})}
}
`;

if (process.argv[2] === '--write') {
  await writeFile(file('tokens.css'), variables);
  await writeFile(file('design/tailwind.css'), tailwind);
}

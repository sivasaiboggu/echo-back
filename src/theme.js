'use strict';

const root = document.documentElement;
if (new URLSearchParams(location.search).get('theme') === 'light') root.dataset.theme = 'light';

document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('themeToggle');
  const label = document.getElementById('themeLabel');
  const color = document.getElementById('themeColor');
  const links = [...document.querySelectorAll('a[data-theme-link]')].map((element) => ({
    element,
    href: element.getAttribute('href'),
  }));

  function syncTheme(announce = false) {
    const light = root.dataset.theme === 'light';
    label.textContent = light ? 'Dark mode' : 'Light mode';
    color.content = getComputedStyle(root).getPropertyValue('--page').trim();
    for (const { element, href } of links) element.href = light ? `${href}?theme=light` : href;
    if (announce) document.dispatchEvent(new Event('themechange'));
  }

  if (!button) return;
  button.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    syncTheme(true);
  });
  syncTheme();
});

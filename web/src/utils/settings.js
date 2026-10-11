export const SETTINGS_KEY = 'mcode.interface.settings.v1';
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'dark', fontSize: 13.5, lineHeight: 1.55, terminalFontSize: 12,
  tabSize: 4, lineNumbers: true, autocomplete: true, autoPairs: true, shortcuts: true,
});

export function normalizeSettings(value) {
  const result = { ...DEFAULT_SETTINGS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of ['lineNumbers', 'autocomplete', 'autoPairs', 'shortcuts']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (['dark', 'light', 'system'].includes(value.theme)) result.theme = value.theme;
  for (const [key, min, max, step] of [['fontSize', 12, 24, 0.5], ['terminalFontSize', 12, 20, 1]]) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
      result[key] = Math.round(Math.max(min, Math.min(max, value[key])) / step) * step;
    }
  }
  if ([1.4, 1.55, 1.8, 2].includes(value.lineHeight)) result.lineHeight = value.lineHeight;
  if ([2, 4, 8].includes(value.tabSize)) result.tabSize = value.tabSize;
  return result;
}

export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY))); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function initSettings(onChange) {
  let settings = loadSettings();
  const root = document.documentElement;
  const dialog = document.getElementById('settingsDialog');
  const controls = [...dialog.querySelectorAll('[data-setting]')];
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const saveStatus = document.getElementById('settingsSaveStatus');

  function apply() {
    const theme = settings.theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : settings.theme;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    root.style.setProperty('--editor-font-size', `${settings.fontSize}px`);
    root.style.setProperty('--editor-line-height', settings.lineHeight);
    root.style.setProperty('--editor-tab-size', settings.tabSize);
    root.style.setProperty('--terminal-font-size', `${settings.terminalFontSize}px`);
    root.classList.toggle('hide-line-numbers', !settings.lineNumbers);
    document.getElementById('gutter').classList.toggle('hidden', !settings.lineNumbers);
    document.getElementById('shortcutBar').classList.toggle('hidden', !settings.shortcuts);
    document.getElementById('indentStatus').textContent = `Espaços: ${settings.tabSize}`;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#1e1e1e' : '#f8fafc';
    for (const control of controls) {
      if (control.type === 'checkbox') control.checked = settings[control.dataset.setting];
      else control.value = settings[control.dataset.setting];
    }
    document.getElementById('fontSizeValue').textContent = `${settings.fontSize} px`;
    document.getElementById('terminalFontSizeValue').textContent = `${settings.terminalFontSize} px`;
    onChange({ ...settings });
  }

  function save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      saveStatus.textContent = 'Preferências salvas neste dispositivo';
    } catch {
      saveStatus.textContent = 'Aplicado nesta sessão. Não foi possível salvar.';
    }
    apply();
  }

  dialog.addEventListener('input', (event) => {
    const control = event.target;
    const key = control.dataset.setting;
    if (!key) return;
    const value = control.type === 'checkbox' ? control.checked
      : typeof DEFAULT_SETTINGS[key] === 'number' ? Number(control.value) : control.value;
    settings = normalizeSettings({ ...settings, [key]: value });
    save();
  });
  document.getElementById('btnResetSettings').addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    save();
  });
  document.getElementById('btnCloseSettings').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  const open = () => { if (!dialog.open) dialog.showModal(); };
  document.getElementById('btnSettings').addEventListener('click', open);
  window.openSettings = open;
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === ',') { event.preventDefault(); open(); }
  });
  if (systemTheme.addEventListener) systemTheme.addEventListener('change', apply);
  else systemTheme.addListener(apply);
  apply();
}

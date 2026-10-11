import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, normalizeSettings, loadSettings } from '../src/utils/settings.js';

test('preferências rejeitam valores inválidos e limitam tamanhos', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings([]), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ theme: 'invalid', lineNumbers: 'false', tabSize: 3, fontSize: NaN }), DEFAULT_SETTINGS);
  const settings = normalizeSettings({ fontSize: 200, terminalFontSize: -1, theme: 'light', lineNumbers: false });
  assert.equal(settings.fontSize, 24);
  assert.equal(settings.terminalFontSize, 12);
  assert.equal(settings.theme, 'light');
  assert.equal(settings.lineNumbers, false);
});

test('preferências toleram armazenamento corrompido ou indisponível', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '{broken' } });
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Unavailable'); } });
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

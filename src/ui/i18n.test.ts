// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyI18n } from './i18n';

const gm = (k: string) => ({ hello: '안녕', bye: '' }[k] ?? '');

describe('applyI18n', () => {
  it('fills textContent from data-i18n', () => {
    document.body.innerHTML = `<span data-i18n="hello">x</span>`;
    applyI18n(document.body, gm);
    expect(document.querySelector('span')!.textContent).toBe('안녕');
  });
  it('fills title and placeholder attributes', () => {
    document.body.innerHTML = `<button data-i18n-title="hello"></button><input data-i18n-placeholder="hello">`;
    applyI18n(document.body, gm);
    expect(document.querySelector('button')!.title).toBe('안녕');
    expect(document.querySelector('input')!.placeholder).toBe('안녕');
  });
  it('keeps existing text when the key is missing/empty', () => {
    document.body.innerHTML = `<span data-i18n="bye">keep</span><span data-i18n="nope">keep2</span>`;
    applyI18n(document.body, gm);
    expect(document.querySelectorAll('span')[0].textContent).toBe('keep');
    expect(document.querySelectorAll('span')[1].textContent).toBe('keep2');
  });
});

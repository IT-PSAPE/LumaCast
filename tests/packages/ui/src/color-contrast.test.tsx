import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Badge, ReacstButton } from '@lumacast/ui';

afterEach(cleanup);

type Color = readonly [number, number, number];

function mixColors(first: Color, second: Color, weight: number): Color {
  const blend = (index: number) => first[index] * weight + second[index] * (1 - weight);
  return [blend(0), blend(1), blend(2)];
}

const theme = fs.readFileSync(path.resolve('packages/ui/src/theme.css'), 'utf8');
const declarations = (source: string) => Object.fromEntries(
  [...source.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2].trim()]),
);
const light = declarations(theme.slice(theme.indexOf('@theme {'), theme.indexOf('/* BASE STYLES */')));
const darkRule = theme.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/);
if (!darkRule) throw new Error('The shared theme has no dark colour roles');
const dark = { ...light, ...declarations(darkRule[1]) };

// Resolve the theme's actual aliases and opaque sRGB mixes, rather than copy
// palette values into the test. An unsupported expression fails explicitly.
function resolveColor(token: string, tokens: Record<string, string>): Color {
  const value = tokens[token];
  if (!value) throw new Error(`Missing colour token ${token}`);
  const hex = value.match(/^#([\da-f]{6})$/i);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)];
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  if (alias) return resolveColor(alias[1], tokens);
  const mix = value.match(/^color-mix\(in srgb,\s*var\((--[\w-]+)\)\s+(\d+(?:\.\d+)?)%,\s*var\((--[\w-]+)\)\)$/);
  if (mix) {
    const first = resolveColor(mix[1], tokens);
    const second = resolveColor(mix[3], tokens);
    const weight = Number(mix[2]) / 100;
    return mixColors(first, second, weight);
  }
  throw new Error(`Unsupported colour expression ${token}: ${value}`);
}

function contrast(first: Color, second: Color): number {
  const luminance = (color: Color) => color
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function utilityColor(utility: string, tokens: Record<string, string>, surface: Color): Color {
  const [name, opacity = '100'] = utility.replace(/^(?:hover:|active:)?(?:bg|text)-/, '').split('/');
  const namespace = utility.includes('text-') ? '--text-color-' : '--background-color-';
  const token = tokens[`${namespace}${name}`] ? `${namespace}${name}` : `--color-${name}`;
  const color = resolveColor(token, tokens);
  const alpha = Number(opacity) / 100;
  return mixColors(color, surface, alpha);
}

function componentContrast(element: HTMLElement, tokens: Record<string, string>, state: '' | 'hover:' | 'active:' = ''): number {
  const classes = element.className.split(/\s+/);
  const background = (state && classes.find((name) => name.startsWith(`${state}bg-`)))
    || classes.find((name) => name.startsWith('bg-'));
  const foreground = classes.find((name) => name.startsWith('text-'));
  if (!background || !foreground) throw new Error(`Missing colour role on ${element.outerHTML}`);
  const surface = resolveColor('--background-color-primary', tokens);
  const fill = utilityColor(background, tokens, surface);
  return contrast(utilityColor(foreground, tokens, fill), fill);
}

describe.each([['light', light], ['dark', dark]] as const)('%s shared control contrast', (_name, tokens) => {
  it.each(['primary', 'danger'] as const)('%s action labels meet 4.5:1 at rest, hover and while pressed', (variant) => {
    const { rerender } = render(<ReacstButton variant={variant}>Action</ReacstButton>);
    const button = screen.getByRole('button', { name: 'Action' });
    for (const state of ['', 'hover:', 'active:'] as const) {
      expect(componentContrast(button, tokens, state), `${variant} ${state || 'rest'}`).toBeGreaterThanOrEqual(4.5);
    }
    rerender(<ReacstButton variant={variant} pressed>Action</ReacstButton>);
    expect(componentContrast(button, tokens)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['neutral', 'brand', 'success', 'warning', 'error'] as const)('%s solid badge labels meet 4.5:1', (tone) => {
    render(<Badge variant="solid" tone={tone}>Status</Badge>);
    expect(componentContrast(screen.getByText('Status'), tokens)).toBeGreaterThanOrEqual(4.5);
  });

  it('the fallback focus mark contrasts with neutral controls and solid actions', () => {
    const focus = resolveColor('--color-focus-ring', tokens);
    for (const fill of ['--background-color-primary', '--background-color-secondary', '--background-color-tertiary', '--color-brand-solid']) {
      expect(contrast(focus, resolveColor(fill, tokens)), fill).toBeGreaterThanOrEqual(3);
    }
  });
});

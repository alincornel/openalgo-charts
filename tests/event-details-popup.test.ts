import { describe, expect, it } from 'vitest';
import { EventDetailsPopup, type EventDetailsLoader } from '../src/widget/event-details';
import { createOverlayStack } from '../src/widget/context';
import type { ChartEventDetails, EventMarkerDetails } from '../src/primitives/event-markers';
import { fakeContainer, fakeWidgetDocument, fire, fireKey, type FakeElement } from './helpers/fake-dom-widget';

const cluster: EventMarkerDetails = { id: 'cluster', cluster: true, events: [
  { id: 'one', time: 100, type: 'earnings', label: 'E', title: 'First results', details: { summary: 'First report', fields: [{ label: 'Revenue', value: '100' }] } },
  { id: 'two', time: 200, type: 'news', label: 'N', title: 'Second report', details: 'Second details' },
] };

function fixture(loadDetails?: EventDetailsLoader) {
  const doc = fakeWidgetDocument();
  const root = fakeContainer(doc, 400, 300);
  const opener = doc.createElement('button');
  root.appendChild(opener);
  opener.focus();
  const popup = new EventDetailsPopup(root as unknown as HTMLElement, { loadDetails, formatTime: time => `Time ${time}` });
  const element = popup.element as unknown as FakeElement;
  return { doc, root, opener, popup, element };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('event details popup', () => {
  it('renders all text safely and lets the user select cluster members', () => {
    const { popup, element } = fixture();
    const data = structuredClone(cluster);
    data.events[0].title = '<img src=x onerror=alert(1)>';
    popup.open(data, { x: 100, y: 200 });
    expect(element.getAttribute('role')).toBe('dialog');
    expect(element.getAttribute('aria-label')).toBeTruthy();
    expect(element.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain('Revenue');
    expect(element.textContent).toContain('100');
    expect(element.textContent).toContain('Time 100');
    const members = element.querySelectorAll('[data-event-index]');
    expect(members).toHaveLength(2);
    fire(members[1], 'click');
    expect(element.querySelector('.oac-event-details__content')!.textContent).toContain('Second details');
    expect(members[1].getAttribute('aria-pressed')).toBe('true');
    expect(members[0].getAttribute('aria-pressed')).toBe('false');
    popup.destroy();
  });

  it('isolates pointer and wheel events, closes on Escape and restores focus', () => {
    const { popup, element, root, doc, opener } = fixture();
    let presses = 0;
    let wheels = 0;
    root.addEventListener('pointerdown', () => { presses++; });
    root.addEventListener('wheel', () => { wheels++; });
    popup.open(cluster);
    expect(element.contains(doc.activeElement)).toBe(true);
    fire(element, 'pointerdown');
    fire(element, 'wheel');
    expect(presses).toBe(0);
    expect(wheels).toBe(0);
    fireKey(doc.activeElement, 'Escape');
    expect(element.isConnected).toBe(false);
    expect(doc.activeElement).toBe(opener);
    popup.destroy();
  });

  it('wraps keyboard focus and supports the explicit close control', () => {
    const { popup, element, doc, opener } = fixture();
    popup.open(cluster);
    const close = element.querySelector('[data-action="close-event-details"]')!;
    const buttons = element.querySelectorAll('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    const tab = fireKey(last, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(close);
    fire(close, 'click');
    expect(element.isConnected).toBe(false);
    expect(doc.activeElement).toBe(opener);
    popup.destroy();
  });

  it('owns member data while open', () => {
    const { popup, element } = fixture();
    const data = structuredClone(cluster);
    popup.open(data);
    data.events[1].details = 'Mutated';
    fire(element.querySelectorAll('[data-event-index]')[1], 'click');
    expect(element.querySelector('.oac-event-details__content')!.textContent).toContain('Second details');
    popup.destroy();
  });

  it('aborts the prior selection and ignores its late completion', async () => {
    const first = deferred<ChartEventDetails>();
    const second = deferred<ChartEventDetails>();
    const signals: AbortSignal[] = [];
    const { popup, element } = fixture((event, { signal }) => {
      signals.push(signal);
      return event.id === 'one' ? first.promise : second.promise;
    });
    popup.open(cluster);
    expect(element.querySelector('[role="status"]')!.textContent).toContain('Loading');
    fire(element.querySelectorAll('[data-event-index]')[1], 'click');
    expect(signals[0].aborted).toBe(true);
    second.resolve({ summary: 'Current remote details' });
    await second.promise;
    await Promise.resolve();
    expect(element.textContent).toContain('Current remote details');
    first.resolve({ summary: 'Stale remote details' });
    await first.promise;
    await Promise.resolve();
    expect(element.textContent).not.toContain('Stale remote details');
    expect(element.textContent).toContain('Current remote details');
    popup.destroy();
  });

  it('aborts on close, reopen and disposal without applying stale results', async () => {
    const requests: ReturnType<typeof deferred<string>>[] = [];
    const signals: AbortSignal[] = [];
    const { popup, element, root } = fixture((_event, { signal }) => {
      signals.push(signal);
      const request = deferred<string>();
      requests.push(request);
      return request.promise;
    });
    popup.open(cluster);
    popup.close();
    expect(signals[0].aborted).toBe(true);
    popup.open(cluster);
    popup.open(cluster);
    expect(signals[1].aborted).toBe(true);
    popup.destroy();
    expect(signals[2].aborted).toBe(true);
    for (const request of requests) request.resolve('Late details');
    await Promise.all(requests.map(request => request.promise));
    await Promise.resolve();
    expect(element.textContent).not.toContain('Late details');
    expect(root.querySelector('.oac-event-details')).toBeNull();
    popup.open(cluster);
    expect(root.querySelector('.oac-event-details')).toBeNull();
  });

  it('keeps supplied details available when a loader fails and handles synchronous throws', async () => {
    const { popup, element } = fixture(() => { throw new Error('private backend message'); });
    popup.open(cluster);
    await Promise.resolve();
    expect(element.textContent).toContain('First report');
    expect(element.querySelector('[role="status"]')!.textContent).toContain('Unable');
    expect(element.textContent).not.toContain('private backend message');
    popup.destroy();
  });

  it('contains popup positioning within a small host and installs a nonce-bearing shared stylesheet', () => {
    const doc = fakeWidgetDocument();
    const root = fakeContainer(doc, 200, 120);
    const popup = new EventDetailsPopup(root as unknown as HTMLElement, { styleNonce: 'allowed' });
    const element = popup.element as unknown as FakeElement;
    element.offsetWidth = 180;
    element.offsetHeight = 100;
    popup.open(cluster, { x: 1000, y: 1000 });
    expect(parseFloat(String(element.style.left))).toBeGreaterThanOrEqual(0);
    expect(parseFloat(String(element.style.left)) + 180).toBeLessThanOrEqual(200);
    expect(parseFloat(String(element.style.top)) + 100).toBeLessThanOrEqual(120);
    expect(doc.head.querySelector('style')!.getAttribute('nonce')).toBe('allowed');
    const second = new EventDetailsPopup(root as unknown as HTMLElement);
    expect(doc.head.querySelectorAll('style')).toHaveLength(1);
    second.destroy();
    popup.destroy();
  });

  it('does not open empty data or restore focus over a newer user selection', () => {
    const { popup, element, root, doc } = fixture();
    popup.open({ id: 'empty', cluster: false, events: [] });
    expect(element.isConnected).toBe(false);
    popup.open(cluster);
    const other = doc.createElement('button');
    root.appendChild(other);
    other.focus();
    popup.close();
    expect(doc.activeElement).toBe(other);
    popup.destroy();
  });

  it('positions in shared overlay coordinates and leaves the shared stack alive on disposal', () => {
    const doc = fakeWidgetDocument();
    const root = fakeContainer(doc, 600, 400);
    const chart = doc.createElement('div');
    chart.rect = { left: 50, top: 40, width: 400, height: 300 };
    root.appendChild(chart);
    const overlays = createOverlayStack(root as unknown as HTMLElement, doc as unknown as Document);
    const layer = overlays.layer as unknown as FakeElement;
    layer.rect = { left: 0, top: 0, width: 600, height: 400 };
    const popup = new EventDetailsPopup(chart as unknown as HTMLElement, { overlays });
    const element = popup.element as unknown as FakeElement;
    element.offsetWidth = 180;
    element.offsetHeight = 100;
    popup.open(cluster, { x: 100, y: 200 });
    expect(element.style.left).toBe('150px');
    expect(element.style.top).toBe('128px');
    expect(overlays.size()).toBe(1);
    popup.destroy();
    expect(overlays.size()).toBe(0);
    expect(layer.isConnected).toBe(true);
    overlays.destroy();
  });
});

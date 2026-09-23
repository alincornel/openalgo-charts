import { describe, it, expect } from 'vitest';
import { workspaceFileDocument } from '../src/workspaces.js';

describe('reference layout file compatibility', () => {
  it('accepts an older wrapped file with explicit source metadata as a named document', () => {
    const layout = { schema: 2, version: 1, dataset: 'MSFT|1d|1y', chartType: 'line', indicators: [] };
    const result = workspaceFileDocument(JSON.stringify({ app: 'openalgo-charts yfinance demo', layout }), 'Desk.json');
    expect(result).toMatchObject({ kind: 'workspace', name: 'Desk', panes: [{ symbol: 'MSFT', interval: '1d', chartType: 'line' }] });
  });

  it('leaves named portable documents to the existing catalog validator', () => {
    const input = { kind: 'workspace', version: 1, name: 'Source' };
    expect(workspaceFileDocument(JSON.stringify(input), 'ignored.json')).toEqual(input);
  });

  it('refuses an ambiguous legacy source without guessing from the live chart', () => {
    expect(() => workspaceFileDocument(JSON.stringify({ schema: 2, version: 1, dataset: 'A|B|1d|1y' }), 'Old.json')).toThrow(/source|request/i);
  });

  it('rejects invalid JSON before any chart or repository action', () => {
    expect(() => workspaceFileDocument('{invalid', 'Bad.json')).toThrow();
  });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ApiDirectory from '../src/ui/ApiDirectory';
import Rail from '../src/ui/Rail';
import { fetchUrl } from '../src/lib/connectors';
vi.mock('../src/lib/connectors', () => ({ fetchUrl: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
function mount(element: React.ReactNode) {
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host); act(() => root.render(element));
}
function click(selector: string) { act(() => (host.querySelector(selector) as HTMLButtonElement).click()); }
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.clearAllMocks(); });

describe('API directory interactions', () => {
  it('offers a primary navigation tab', () => {
    const setPage = vi.fn();
    mount(<Rail page="apis" setPage={setPage} collapsed={false} toggle={vi.fn()} badge={{}} />);
    click('[aria-current="page"]');
    expect(setPage).toHaveBeenCalledWith('apis');
    expect(host.textContent).toContain('API directory');
  });
  it('makes no request on mount, paginates, resets pagination after filtering, and drafts without executing', () => {
    const onUse = vi.fn();
    mount(<ApiDirectory onUse={onUse} webEnabled openConnectors={vi.fn()} />);
    expect(fetchUrl).not.toHaveBeenCalled();
    expect(host.querySelectorAll('article')).toHaveLength(24);
    click('[aria-label="Use NASA Images in workspace"]');
    expect(onUse).toHaveBeenCalledWith(expect.stringContaining('https://images-api.nasa.gov/search'));
    expect(fetchUrl).not.toHaveBeenCalled();
    act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Next')!.click());
    expect(host.querySelector('[aria-label="API pages"]')?.textContent).toContain('Page 2');
    const input = [...host.querySelectorAll('label')].find(label => label.textContent === 'Reviewed examples only')!.querySelector('input')!;
    act(() => input.click());
    expect(host.querySelectorAll('article')).toHaveLength(6);
    expect(host.querySelector('[aria-label="API pages"]')?.textContent).toContain('Page 1 of 1');
  });
  it('reads one reviewed endpoint only on click and renders the response as text', async () => {
    vi.mocked(fetchUrl).mockResolvedValue({ url: 'https://images-api.nasa.gov/search', status: 200, contentType: 'application/json', text: '<script>bad()</script>', title: '', description: '', headings: [], links: [], wordCount: 1, truncated: true });
    mount(<ApiDirectory onUse={vi.fn()} webEnabled openConnectors={vi.fn()} />);
    await act(async () => { (host.querySelector('[aria-label="Read NASA Images example"]') as HTMLButtonElement).click(); });
    expect(fetchUrl).toHaveBeenCalledTimes(1);
    expect(fetchUrl).toHaveBeenCalledWith('https://images-api.nasa.gov/search?q=apollo%2011&media_type=image&page_size=2', expect.any(AbortSignal));
    expect(host.querySelector('pre')?.textContent).toBe('<script>bad()</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('Response text truncated');
  });
  it('respects the agent URL-reader toggle and reports upstream failure', async () => {
    vi.mocked(fetchUrl).mockRejectedValue(new Error('Host is not allowed'));
    mount(<ApiDirectory onUse={vi.fn()} webEnabled={false} openConnectors={vi.fn()} />);
    expect((host.querySelector('[aria-label="Use NASA Images in workspace"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { (host.querySelector('[aria-label="Read NASA Images example"]') as HTMLButtonElement).click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Host is not allowed');
  });
  it('aborts an outstanding public read when the tab unmounts', () => {
    vi.mocked(fetchUrl).mockReturnValue(new Promise(() => {}));
    mount(<ApiDirectory onUse={vi.fn()} webEnabled openConnectors={vi.fn()} />);
    click('[aria-label="Read NASA Images example"]');
    const signal = vi.mocked(fetchUrl).mock.calls[0][1];
    act(() => root.unmount());
    expect(signal.aborted).toBe(true);
  });
});

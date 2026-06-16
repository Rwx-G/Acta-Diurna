import { describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import ReaderWidthControl from './ReaderWidthControl.svelte';

// The popover is absolutely positioned; drive it through the DOM (querySelector + a
// native click) rather than Playwright actionability, which is flaky against an
// off-flow overlay. The control owns no state - it reports every change through
// `onChange` - so the spy is the assertion surface. `await tick()` lets the disclosure
// render before the inner controls are queried.
async function open(container: HTMLElement): Promise<void> {
	(container.querySelector('.width-trigger') as HTMLButtonElement).click();
	await tick();
}
function byText(container: HTMLElement, selector: string, text: string): HTMLButtonElement {
	const el = [...container.querySelectorAll(selector)].find(
		(node) => node.textContent?.trim() === text
	);
	if (!el) throw new Error(`no ${selector} with text "${text}"`);
	return el as HTMLButtonElement;
}
function byAria(container: HTMLElement, label: string): HTMLElement {
	const el = container.querySelector(`[aria-label="${label}"]`);
	if (!el) throw new Error(`no element labelled "${label}"`);
	return el as HTMLElement;
}

describe('ReaderWidthControl', () => {
	it('shows the full-bleed state in the trigger and opens the popover', async () => {
		const { container, getByRole } = render(ReaderWidthControl, {
			value: undefined,
			editable: true,
			onChange: vi.fn()
		});

		await expect.element(getByRole('button', { name: 'Reader width (Full width)' })).toBeVisible();
		await open(container);
		await expect.element(getByRole('group', { name: 'Reader width', exact: true })).toBeVisible();
	});

	it('shows the fixed width in the trigger label', async () => {
		const { getByRole } = render(ReaderWidthControl, {
			value: 1280,
			editable: true,
			onChange: vi.fn()
		});
		await expect.element(getByRole('button', { name: 'Reader width (1280 px)' })).toBeVisible();
	});

	it('switches to a fixed width with a sensible default', async () => {
		const onChange = vi.fn();
		const { container } = render(ReaderWidthControl, {
			value: undefined,
			editable: true,
			onChange
		});
		await open(container);
		byText(container, '.seg button', 'Fixed').click();
		expect(onChange).toHaveBeenCalledExactlyOnceWith(1080);
	});

	it('switches back to full-bleed by clearing the width', async () => {
		const onChange = vi.fn();
		const { container } = render(ReaderWidthControl, { value: 1280, editable: true, onChange });
		await open(container);
		byText(container, '.seg button', 'Full width').click();
		expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined);
	});

	it('applies a preset', async () => {
		const onChange = vi.fn();
		const { container } = render(ReaderWidthControl, { value: 1080, editable: true, onChange });
		await open(container);
		byText(container, '.chip', '1600').click();
		expect(onChange).toHaveBeenCalledExactlyOnceWith(1600);
	});

	it('steps the width up by the step', async () => {
		const onChange = vi.fn();
		const { container } = render(ReaderWidthControl, { value: 1080, editable: true, onChange });
		await open(container);
		(byAria(container, 'Increase width') as HTMLButtonElement).click();
		expect(onChange).toHaveBeenCalledExactlyOnceWith(1100);
	});

	it('clamps a custom value committed below the minimum', async () => {
		const onChange = vi.fn();
		const { container } = render(ReaderWidthControl, { value: 1080, editable: true, onChange });
		await open(container);
		const input = byAria(container, 'Max width in pixels') as HTMLInputElement;
		input.value = '100';
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onChange).toHaveBeenCalledExactlyOnceWith(640);
		expect(input.value).toBe('640');
	});

	it('cannot be opened when the report is not editable', async () => {
		const { getByRole } = render(ReaderWidthControl, {
			value: undefined,
			editable: false,
			onChange: vi.fn()
		});
		await expect.element(getByRole('button', { name: /Reader width/ })).toBeDisabled();
	});
});

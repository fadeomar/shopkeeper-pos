import { expect, test, type Page } from '@playwright/test';
import { initializeDemoData, loginAsCashier } from './helpers/auth';

type A11yIssue = { selector: string; text: string; issue: string };

const ROUTES: Array<{ path: string; heading: RegExp }> = [
  { path: '/', heading: /my shop|asas pos|welcome/i },
  { path: '/billing', heading: /create bill/i },
  { path: '/purchases/new', heading: /new purchase/i },
  { path: '/products', heading: /^products$/i },
  { path: '/inventory', heading: /^inventory$/i },
  { path: '/customers', heading: /^customers$/i },
  { path: '/suppliers', heading: /suppliers & payables/i },
  { path: '/reports', heading: /^reports$/i },
  { path: '/settings', heading: /^settings$/i },
];

function formatIssues(issues: A11yIssue[]) {
  return issues.map((issue) => `${issue.issue}: ${issue.selector} ${issue.text ? `(${issue.text})` : ''}`).join('\n');
}

async function collectA11ySmokeIssues(page: Page): Promise<A11yIssue[]> {
  return page.evaluate(() => {
    const isHidden = (element: Element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
      const style = window.getComputedStyle(element);
      return style.display === 'none' || style.visibility === 'hidden';
    };

    const isVisible = (element: Element) => {
      if (!(element instanceof HTMLElement)) return true;
      if (isHidden(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const getCssPath = (element: Element) => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && parts.length < 5) {
        const tag = current.tagName.toLowerCase();
        const id = current.id ? `#${current.id}` : '';
        const testId = current.getAttribute('data-testid') ? `[data-testid="${current.getAttribute('data-testid')}"]` : '';
        const label = current.getAttribute('aria-label') ? `[aria-label="${current.getAttribute('aria-label')}"]` : '';
        parts.unshift(`${tag}${id}${testId}${label}`);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };

    const hasAccessibleName = (element: Element) => {
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      const ariaLabelledBy = element.getAttribute('aria-labelledby')?.trim();
      const title = element.getAttribute('title')?.trim();
      const placeholder = element.getAttribute('placeholder')?.trim();
      const text = element.textContent?.trim();
      const id = element.getAttribute('id');
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() : '';
      const wrappedLabel = element.closest('label')?.textContent?.trim();
      return Boolean(ariaLabel || ariaLabelledBy || title || placeholder || text || label || wrappedLabel);
    };

    const issues: A11yIssue[] = [];
    const duplicateIds = new Set<string>();
    const seenIds = new Set<string>();

    document.querySelectorAll<HTMLElement>('[id]').forEach((element) => {
      const id = element.id.trim();
      if (!id) return;
      if (seenIds.has(id)) duplicateIds.add(id);
      seenIds.add(id);
    });

    duplicateIds.forEach((id) => {
      issues.push({ selector: `#${id}`, text: '', issue: 'Duplicate id' });
    });

    document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="combobox"]')
      .forEach((element) => {
        if (!isVisible(element)) return;
        if (element.getAttribute('aria-hidden') === 'true') return;
        if (!hasAccessibleName(element)) {
          issues.push({ selector: getCssPath(element), text: element.textContent?.trim().slice(0, 60) ?? '', issue: 'Interactive element has no accessible name' });
        }
      });

    document.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      if (!isVisible(image)) return;
      if (!image.hasAttribute('alt')) {
        issues.push({ selector: getCssPath(image), text: image.getAttribute('src') ?? '', issue: 'Image is missing alt text' });
      }
    });

    const headings = [...document.querySelectorAll('h1, h2, [role="heading"]')].filter(isVisible);
    if (headings.length === 0) {
      issues.push({ selector: 'main', text: '', issue: 'Page has no visible heading' });
    }

    const doc = document.documentElement;
    if (Math.ceil(doc.scrollWidth - doc.clientWidth) > 4) {
      issues.push({ selector: 'html', text: `${doc.scrollWidth}px > ${doc.clientWidth}px`, issue: 'Horizontal page overflow' });
    }

    return issues;
  });
}

async function expectA11ySmokePass(page: Page) {
  const issues = await collectA11ySmokeIssues(page);
  expect(issues, formatIssues(issues)).toEqual([]);
}

test.describe('authenticated accessibility smoke', () => {
  test('core cashier pages have named controls, headings, image alt text, and no horizontal overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'accessibility smoke runs once on desktop');

    await loginAsCashier(page);
    await initializeDemoData(page);

    for (const route of ROUTES) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expectA11ySmokePass(page);
    }
  });
});

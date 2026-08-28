// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BindingSections from '../../src/webview/BindingSections.svelte';
import type { BindingSection } from '../../src/webview/lib/bindingView';
import type { DomainProcessBindingIssue, DomainProcessBindingRow, DomainProcessBindingRules, IndexedIssue } from '../../src/webview/types';

const postMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/webview/vscodeApi', () => ({ postMessage }));

const rules = {} as unknown as DomainProcessBindingRules;

function row(overrides: Partial<DomainProcessBindingRow> = {}): DomainProcessBindingRow {
    return {
        developerName: 'Account_Before_Insert_Test',
        source: 'local',
        label: 'Test',
        sobject: 'Account',
        type: 'Action',
        classToInject: 'MyActionClass',
        order: 10,
        isActive: true,
        executeAsynchronous: false,
        preventRecursive: false,
        logicalInverse: false,
        ...overrides,
    } as DomainProcessBindingRow;
}

function section(title: string, rows: DomainProcessBindingRow[]): BindingSection {
    return { title, rows };
}

function issuesMap(entries: { row: DomainProcessBindingRow; issue: Partial<DomainProcessBindingIssue> }[]): Map<string, IndexedIssue[]> {
    const map = new Map<string, IndexedIssue[]>();
    entries.forEach(({ row: r, issue }, index) => {
        const key = `${r.developerName} ${r.source}`;
        const list = map.get(key) ?? [];
        list.push({ index, issue: { rule: 'order-collision', severity: 'error', message: 'Collides.', developerName: r.developerName, source: r.source, ...issue } as DomainProcessBindingIssue });
        map.set(key, list);
    });
    return map;
}

afterEach(() => {
    cleanup();
    postMessage.mockClear();
});

describe('BindingSections', () => {
    it('renders no band for a section with one sequence prefix, rows go straight under the header', () => {
        const rows = [row({ developerName: 'A', order: 10.1 }), row({ developerName: 'B', order: 10.2 })];
        render(BindingSections, { props: { sections: [section('Record Before Save', rows)], issuesByRecord: new Map(), rules, onEdit: vi.fn() } });

        expect(document.querySelectorAll('.seq-caption')).toHaveLength(0);
        expect(document.querySelectorAll('.row')).toHaveLength(2);
    });

    it('renders one band per sequence prefix for a section spanning two prefixes', () => {
        const rows = [row({ developerName: 'A', order: 10.1 }), row({ developerName: 'B', order: 10.2 }), row({ developerName: 'C', order: 20.1 })];
        render(BindingSections, { props: { sections: [section('Record Before Save', rows)], issuesByRecord: new Map(), rules, onEdit: vi.fn() } });

        expect(document.querySelectorAll('.seq-caption')).toHaveLength(2);
        expect(screen.getByText('10')).toBeTruthy();
        expect(screen.getByText('20')).toBeTruthy();
    });

    it('collapses a band on click, hiding only that group\'s rows and flipping aria-expanded', async () => {
        const rows = [row({ developerName: 'A', order: 10.1 }), row({ developerName: 'B', order: 20.1 })];
        render(BindingSections, { props: { sections: [section('Record Before Save', rows)], issuesByRecord: new Map(), rules, onEdit: vi.fn() } });

        const captions = document.querySelectorAll<HTMLButtonElement>('.seq-caption');
        const firstCaption = captions[0];
        expect(firstCaption.getAttribute('aria-expanded')).toBe('true');

        await fireEvent.click(firstCaption);

        expect(firstCaption.getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelectorAll('.row')).toHaveLength(1);
    });

    it('shows an issue count on a collapsed band containing a badged row, hidden while expanded', async () => {
        const rows = [row({ developerName: 'A', order: 10.1 }), row({ developerName: 'B', order: 20.1 })];
        const issuesByRecord = issuesMap([{ row: rows[0], issue: {} }]);
        render(BindingSections, { props: { sections: [section('Record Before Save', rows)], issuesByRecord, rules, onEdit: vi.fn() } });

        expect(document.querySelector('.seq-issues')).toBeNull();

        const caption = document.querySelectorAll<HTMLButtonElement>('.seq-caption')[0];
        await fireEvent.click(caption);

        expect(document.querySelector('.seq-issues')?.textContent).toContain('1');
    });

    it('collapses each section-and-prefix pair independently', async () => {
        const rowsBefore = [row({ developerName: 'A', order: 10.1 }), row({ developerName: 'B', order: 20.1 })];
        const rowsAfter = [row({ developerName: 'C', order: 10.1 }), row({ developerName: 'D', order: 20.1 })];
        render(BindingSections, {
            props: {
                sections: [section('Record Before Save', rowsBefore), section('Record After Save', rowsAfter)],
                issuesByRecord: new Map(),
                rules,
                onEdit: vi.fn(),
            },
        });

        const captions = document.querySelectorAll<HTMLButtonElement>('.seq-caption');
        await fireEvent.click(captions[0]);

        expect(captions[0].getAttribute('aria-expanded')).toBe('false');
        expect(captions[2].getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelectorAll('.row')).toHaveLength(3);
    });
});

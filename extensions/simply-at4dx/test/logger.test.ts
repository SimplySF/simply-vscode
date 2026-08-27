import { describe, expect, it } from 'vitest';
import { redactProxyUrl, truncate } from '../src/logger';

describe('truncate', () => {
    it('returns short values unchanged', () => {
        expect(truncate('short')).toBe('short');
    });

    it('truncates values over the length limit and appends a marker', () => {
        const long = 'x'.repeat(20_001);

        const result = truncate(long);

        expect(result.length).toBe(20_000 + '\n…(truncated)'.length);
        expect(result.startsWith('x'.repeat(20_000))).toBe(true);
        expect(result.endsWith('\n…(truncated)')).toBe(true);
    });

    it('leaves a value exactly at the limit unchanged', () => {
        const exact = 'x'.repeat(20_000);

        expect(truncate(exact)).toBe(exact);
    });
});

describe('redactProxyUrl', () => {
    it('strips embedded credentials from an http proxy URL', () => {
        expect(redactProxyUrl('http://user:pass@proxy.internal:8080')).toBe('http://proxy.internal:8080');
    });

    it('strips embedded credentials from an https proxy URL', () => {
        expect(redactProxyUrl('https://user:pass@proxy.internal:8080')).toBe('https://proxy.internal:8080');
    });

    it('is case-insensitive on the scheme', () => {
        expect(redactProxyUrl('HTTPS://user:pass@proxy.internal:8080')).toBe('HTTPS://proxy.internal:8080');
    });

    it('leaves a URL with no embedded credentials unchanged', () => {
        expect(redactProxyUrl('http://proxy.internal:8080')).toBe('http://proxy.internal:8080');
    });

    it('leaves a non-URL value unchanged', () => {
        expect(redactProxyUrl('not set')).toBe('not set');
    });
});

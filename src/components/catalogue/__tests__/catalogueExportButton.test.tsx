// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CatalogueExportButton } from '../CatalogueExportButton';
import { productsApi } from '../../../api/products';
import { saveBlob } from '../../uploads/shared';

vi.mock('../../../api/products', () => ({ productsApi: { list: vi.fn() } }));
vi.mock('../../uploads/shared', () => ({ saveBlob: vi.fn() }));
const page = { items: [], nextCursor: null, counts: { all: 0 } };
beforeEach(() => { vi.mocked(productsApi.list).mockReset(); vi.mocked(saveBlob).mockClear(); });
afterEach(cleanup);

describe('Export Excel button', () => {
  it('shows progress, prevents double exports and downloads the workbook', async () => {
    let release!: (value: typeof page) => void;
    vi.mocked(productsApi.list).mockImplementation(() => new Promise(resolve => { release = resolve; }) as never);
    render(<CatalogueExportButton filter={{ tab: 'all', q: 'milk' }} categories={new Map()} />);
    const button = screen.getByRole('button', { name: 'Export Excel' });
    fireEvent.click(button); fireEvent.click(button);
    expect(productsApi.list).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Exporting 0…')).toBeTruthy();
    release(page);
    await screen.findByText('Exported 0 products.');
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^qorloop-catalogue-\d{4}-\d{2}-\d{2}\.xlsx$/));
  });

  it('shows a failed export and permits retry without downloading a partial workbook', async () => {
    vi.mocked(productsApi.list).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(page as never);
    render(<CatalogueExportButton filter={{ tab: 'all' }} categories={new Map()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Connection lost');
    expect(saveBlob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
  });
});

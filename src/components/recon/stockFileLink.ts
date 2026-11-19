import type { ReconMarketplaceId, ReconReference } from '../../api/recon';
import { pathFor } from '../../routes/paths';
import { realMarketplaceValuesEnabled } from '../../lib/features';
import { exportLink } from '../updateFiles/urlState';

/**
 * Open the file preview with the choices needed to send Qorloop's stock availability to one marketplace: the Export
 * step of Update files when it is on, else the Generate files form.
 */
export const stockFileLink = (marketplaceId: ReconMarketplaceId, reference: ReconReference) =>
  realMarketplaceValuesEnabled()
    ? exportLink({ marketplace: marketplaceId, kind: 'stock', scope: 'mismatches', reference })
    : `${pathFor('outputs-generate')}?${new URLSearchParams({ marketplace: marketplaceId, kind: 'stock', scope: 'mismatches', reference, from: 'stock-mismatch' })}`;

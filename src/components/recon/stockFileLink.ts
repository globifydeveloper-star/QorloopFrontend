import type { ReconMarketplaceId, ReconReference } from '../../api/recon';
import { pathFor } from '../../routes/paths';

/** Open the file preview with the choices needed to send Qorloop's stock availability to one marketplace. */
export const stockFileLink = (marketplaceId: ReconMarketplaceId, reference: ReconReference) =>
  `${pathFor('outputs-generate')}?${new URLSearchParams({ marketplace: marketplaceId, kind: 'stock', scope: 'mismatches', reference, from: 'stock-mismatch' })}`;

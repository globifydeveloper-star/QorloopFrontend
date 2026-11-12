import type { Role } from '../api/types';
import type { ViewType } from '../types';

/**
 * Every word on the "How it works" page (/how-it-works). Edit the text here; the page only lays it out.
 *
 * Rules for this file, so the text stays easy to translate:
 * - Every string is a whole sentence or a whole label. Never build a sentence from pieces.
 * - Plain words, short sentences. Describe only what the product does today.
 * - Buttons name a screen by its ViewType; the page turns it into the router path (src/routes/paths.ts).
 */

export type HowItWorksIcon = 'upload' | 'changes' | 'marketplace' | 'dashboard' | 'fix' | 'file';

export interface HowItWorksSection {
  /** The anchor id used by the "Jump to" list. */
  id: string;
  title: string;
}

export interface LoopStep {
  id: string;
  icon: HowItWorksIcon;
  title: string;
  text: string;
  action: { label: string; view: ViewType };
}

export interface Term {
  term: string;
  meaning: string;
  /** Shown with an "Urgent" badge. */
  urgent?: boolean;
}

export interface Situation {
  id: string;
  title: string;
  steps: string[];
}

/** true: the role can do it. 'if-allowed': only when the store allows it in Settings. */
export type RoleCell = boolean | 'if-allowed';

export interface RoleCapability {
  id: string;
  label: string;
  /** The backend permissions behind this row (packages/core/src/roles.ts in the backend repo). Not shown. */
  permissions: string[];
  roles: Record<Role, RoleCell>;
}

export const HOW_IT_WORKS = {
  title: 'How it works',
  intro: 'A short guide to Qorloop for store managers. It takes about three minutes to read.',
  jumpToLabel: 'Jump to',

  sections: {
    what: { id: 'what-qorloop-does', title: 'What Qorloop does' },
    loop: { id: 'daily-loop', title: 'The daily loop' },
    sources: { id: 'where-numbers-come-from', title: 'Where the numbers come from' },
    words: { id: 'dashboard-words', title: 'What the Dashboard words mean' },
    situations: { id: 'common-situations', title: 'Common situations' },
    limits: { id: 'can-and-cannot', title: 'What you can and cannot do' },
    roles: { id: 'who-can-do-what', title: 'Who can do what' },
    tips: { id: 'tips', title: 'Tips' },
    glossary: { id: 'glossary', title: 'Words used in Qorloop' },
  } satisfies Record<string, HowItWorksSection>,

  what: [
    'Qorloop finds where your own stock and prices differ from what Talabat and Snoonu show to customers.',
    'It helps you fix them, and it builds the corrected files to send back to each marketplace.',
    'Qorloop never changes anything on a marketplace by itself. You upload the file in the marketplace’s own portal.',
  ],

  loopIntro: 'Do these six steps every day, in this order.',
  loop: [
    {
      id: 'upload-erp', icon: 'upload',
      title: 'Upload the ERP file',
      text: 'Upload today’s file from your ERP system.',
      action: { label: 'Open Uploads', view: 'uploads' },
    },
    {
      id: 'check-changes', icon: 'changes',
      title: 'Check what changed',
      text: 'Open the upload and read its Changes list: new products, price and stock changes, and stock conflicts.',
      action: { label: 'Open Uploads', view: 'uploads' },
    },
    {
      id: 'upload-marketplaces', icon: 'marketplace',
      title: 'Upload the latest Marketplace files',
      text: 'Export the files from each marketplace portal and upload them here.',
      action: { label: 'Open Uploads', view: 'uploads' },
    },
    {
      id: 'look-dashboard', icon: 'dashboard',
      title: 'Look at the Dashboard',
      text: 'See the stock problems and price problems for each marketplace. The urgent ones come first.',
      action: { label: 'Open Dashboard', view: 'dashboard' },
    },
    {
      id: 'fix', icon: 'fix',
      title: 'Fix them',
      text: 'Edit one product’s stock or price, or change many products at once.',
      action: { label: 'Open Catalogue', view: 'catalogue' },
    },
    {
      id: 'generate', icon: 'file',
      title: 'Generate the corrected file',
      text: 'Generate the file and check it. Upload it in the marketplace portal. Then upload the marketplace’s fresh export here to confirm the numbers drop to zero.',
      action: { label: 'Open Generated files', view: 'outputs-generate' },
    },
  ] satisfies LoopStep[],

  sources: [
    { term: 'ERP file', meaning: 'The source of truth for stock.' },
    { term: 'Catalogue', meaning: 'Qorloop’s copy of your products. You can adjust it.' },
    { term: 'Marketplace file', meaning: 'A snapshot of what the marketplace showed when you uploaded it. The Dashboard says how old it is.' },
    { term: 'Comparison', meaning: 'Qorloop checks the catalogue against that snapshot.' },
  ] satisfies Term[],

  words: [
    { term: 'Stock problem', meaning: 'The marketplace shows a product as available or unavailable, and that does not match your stock.' },
    { term: 'Available but out of stock', meaning: 'Customers can order items you cannot deliver. Fix these first.', urgent: true },
    { term: 'Lost sales', meaning: 'You have stock, but the marketplace shows the product as unavailable.' },
    { term: 'Price problem', meaning: 'The marketplace price differs from the expected price from your pricing rules.' },
    { term: 'Not listed', meaning: 'The product is in your catalogue but not in the marketplace file.' },
    { term: 'Missing from ERP', meaning: 'The product is in the marketplace file but not in your ERP file.' },
    { term: 'New', meaning: 'A new product from the ERP that is waiting to be activated.' },
    { term: 'Out of date', meaning: 'The uploaded file is older than the limit you set in Settings.' },
    { term: 'N stock conflicts', meaning: 'An ERP file changed a stock that someone had edited by hand. The edited value stays until you choose.' },
  ] satisfies Term[],

  compareTitle: 'The “Compare prices with” switch (under Advanced)',
  compare: [
    { term: 'My pricing', meaning: 'The price your pricing rules give each product. The Dashboard, reports and generated files use it unless you open Advanced.' },
    { term: 'ERP price (advanced)', meaning: 'The raw price from your ERP file, without your markup. Only under Advanced.' },
  ] satisfies Term[],
  compareWarning: 'Never upload a file made against the ERP price to a real marketplace.',

  situationsIntro: 'Open a situation to see the steps.',
  situations: [
    {
      id: 'stock-wrong', title: 'Stock is wrong on a marketplace',
      steps: [
        'Upload a fresh file from that marketplace.',
        'Open the Dashboard and find the product under Needs attention.',
        'Open the product in the Catalogue and correct its stock.',
        'Generate the corrected file and upload it in the marketplace portal.',
      ],
    },
    {
      id: 'price-wrong', title: 'A price is wrong',
      steps: [
        'Open the price report from the Dashboard.',
        'Check the expected price. It comes from your pricing rules.',
        'Change the product’s price, or change the rule in Pricing (in the Admin menu).',
        'Generate the corrected file and upload it in the marketplace portal.',
      ],
    },
    {
      id: 'new-products', title: 'The ERP has 10 new products',
      steps: [
        'Open the upload and look at the new products in its Changes list.',
        'Open the new products in the Catalogue.',
        'Check each one and activate it.',
      ],
    },
    {
      id: 'stock-conflict', title: 'A stock conflict after an ERP upload',
      steps: [
        'A conflict means the ERP changed a stock that someone had edited by hand.',
        'The edited value stays in effect until you choose.',
        'Open Stock conflicts from the Dashboard.',
        'Choose Use ERP to follow the ERP again, or Keep mine to keep the edited value.',
      ],
    },
    {
      id: 'file-rejected', title: 'A marketplace file is rejected or needs mapping',
      steps: [
        'Open the upload. Qorloop asks you to map its columns.',
        'Choose which column holds each value, then give the mapping a name.',
        'You map the columns once. Qorloop remembers them for next time.',
        'If the file is still rejected, export it again from the marketplace portal and upload it again.',
      ],
    },
    {
      id: 'row-errors', title: 'A row has errors',
      steps: [
        'Open the upload.',
        'Choose Download errors (.xlsx) to get a file with each row and its error.',
        'Fix the rows in your file and upload it again.',
      ],
    },
    {
      id: 'mistake', title: 'I made a mistake',
      steps: [
        'There is no single undo button.',
        'Open Activity to see what changed, the old value and who changed it.',
        'To undo a bulk change, run another bulk change that puts the old values back.',
        'For a price, use Go back to the ERP price rules. This removes the product’s own price rule.',
        'For stock, use Reset to ERP. The product follows the ERP stock again.',
      ],
    },
  ] satisfies Situation[],

  canTitle: 'Inside Qorloop you can',
  can: [
    'Edit stock and prices.',
    'See who changed what in Activity.',
  ],
  cannotTitle: 'Keep in mind',
  cannot: [
    'You cannot change Talabat or Snoonu directly from Qorloop.',
    'Stock edits and price rules apply to every marketplace.',
    'Marketplace files carry available or unavailable, not stock quantities.',
  ],

  rolesIntro: 'Your role decides what you can do. An Owner or Admin can change roles in Team.',
  rolesActionHeader: 'What you can do',
  roleCellYes: 'Yes',
  roleCellNo: 'No',
  roleCellIfAllowed: 'If allowed in Settings',
  roleFootnote: '“If allowed in Settings” means an Owner or Admin can turn on “Allow Analysts to export reports”.',
  roles: [
    {
      id: 'view', label: 'See the Dashboard, reports, catalogue, uploads and generated files',
      permissions: ['recon.view', 'reports.view', 'products.view', 'uploads.view', 'files.view'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: true },
    },
    {
      id: 'activity', label: 'See who changed what in Activity',
      permissions: ['activity.view'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: true },
    },
    {
      id: 'download', label: 'Download generated files',
      permissions: ['files.download'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: true },
    },
    {
      id: 'export', label: 'Export reports',
      permissions: ['reports.export'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: 'if-allowed' },
    },
    {
      id: 'upload', label: 'Upload, apply and discard files, and map columns',
      permissions: ['uploads.upload', 'uploads.apply', 'uploads.discard', 'uploads.map'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: false },
    },
    {
      id: 'edit', label: 'Edit stock and prices, one by one or many at once',
      permissions: ['products.edit', 'catalogue.stock_edit', 'pricing.edit', 'pricing.bulk'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: false },
    },
    {
      id: 'activate', label: 'Activate new products and manage categories',
      permissions: ['products.activate', 'categories.manage'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: false },
    },
    {
      id: 'generate', label: 'Preview and generate corrected files',
      permissions: ['files.preview', 'files.generate'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: false },
    },
    {
      id: 'settings', label: 'Change store settings and marketplaces',
      permissions: ['settings.edit', 'marketplaces.edit'],
      roles: { owner: true, admin: true, catalogue_manager: false, analyst: false },
    },
    {
      id: 'team', label: 'Invite team members, change roles and remove members',
      permissions: ['team.invite', 'team.manage_roles', 'team.remove'],
      roles: { owner: true, admin: true, catalogue_manager: false, analyst: false },
    },
    {
      id: 'security', label: 'Change security settings',
      permissions: ['settings.security'],
      roles: { owner: true, admin: false, catalogue_manager: false, analyst: false },
    },
  ] satisfies RoleCapability[],

  tips: [
    'Upload fresh files every day.',
    'Fix urgent items first.',
    'Always preview before you apply a change.',
    'Always check the generated file before you upload it.',
    'Do not leave test edits behind.',
  ],

  glossary: [
    { term: 'ERP', meaning: 'Your own stock and sales system. Its file is the source of truth for stock.' },
    { term: 'Marketplace', meaning: 'A delivery app that sells your products, such as Talabat or Snoonu.' },
    { term: 'Catalogue', meaning: 'Qorloop’s copy of your products, with the stock and prices you can adjust.' },
    { term: 'Listing', meaning: 'A product as it appears on one marketplace.' },
    { term: 'Mismatch', meaning: 'A product whose stock or price on a marketplace differs from Qorloop.' },
    { term: 'Rule chain', meaning: 'The order Qorloop uses to find a product’s expected price. An offer price comes first, then the product’s own rule, then its category rules, and the default rule last.' },
    { term: 'Mapping', meaning: 'Which column in your file holds which value. You set it once per file layout.' },
    { term: 'Store', meaning: 'Your business in Qorloop. Your team, products, files and settings belong to it.' },
  ] satisfies Term[],

  urgentBadge: 'Urgent',
  onboardingLink: 'New to Qorloop? Read How it works.',
  dashboardEmptyLink: 'How Qorloop works',
} as const;

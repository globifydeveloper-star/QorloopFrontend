import type { Role } from '../api/types';
import type { ViewType } from '../types';

/**
 * Every word on the "How it works" page (/how-it-works). Edit the text here; the page only lays it out.
 *
 * Rules for this file, so the text stays easy to translate:
 * - Every string is a whole sentence or a whole label. Never build a sentence from pieces.
 * - Plain words, short sentences. Describe only what the product does today.
 * - Written for a first-time user: keep it short. Put details in "How do I…?", not in the daily steps.
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
  intro: 'New to Qorloop? Start here. It takes about two minutes to read.',
  jumpToLabel: 'Jump to',

  sections: {
    what: { id: 'what-qorloop-does', title: 'What Qorloop does' },
    loop: { id: 'daily-loop', title: 'Your day in five steps' },
    screens: { id: 'where-to-find-things', title: 'Where to find things' },
    words: { id: 'dashboard-words', title: 'What the Dashboard words mean' },
    situations: { id: 'how-do-i', title: 'How do I…?' },
    roles: { id: 'who-can-do-what', title: 'Who can do what' },
    glossary: { id: 'glossary', title: 'Words used in Qorloop' },
  } satisfies Record<string, HowItWorksSection>,

  what: [
    'Qorloop compares your own stock and prices with what Talabat and Snoonu show to customers.',
    'It shows you what is different, helps you fix it, and makes the corrected file for each marketplace.',
  ],
  keepInMindTitle: 'Keep in mind',
  keepInMind: [
    'Qorloop never changes Talabat or Snoonu by itself. You upload the file in the marketplace’s own portal.',
    'Your ERP file is the source of truth for stock.',
    'Every change is saved in Activity, with who made it and the old value.',
  ],

  loopIntro: 'Do these steps every day, in this order. Fix the urgent items first.',
  loop: [
    {
      id: 'upload-erp', icon: 'upload',
      title: 'Upload the ERP file',
      text: 'Upload today’s file from your ERP system. Its Changes list shows new products and price and stock changes.',
      action: { label: 'Open Uploads', view: 'uploads' },
    },
    {
      id: 'upload-marketplaces', icon: 'marketplace',
      title: 'Upload the marketplace files',
      text: 'Export today’s file from the Talabat and Snoonu portals and upload them here.',
      action: { label: 'Open Uploads', view: 'uploads' },
    },
    {
      id: 'look-dashboard', icon: 'dashboard',
      title: 'Look at the Dashboard',
      text: 'See how many stock and price problems each marketplace has. The urgent ones come first.',
      action: { label: 'Open Dashboard', view: 'dashboard' },
    },
    {
      id: 'fix', icon: 'fix',
      title: 'Fix them in Update files',
      text: 'Review what differs, then adjust the stock and prices to send. You can change many products at once.',
      action: { label: 'Open Update files', view: 'update-files' },
    },
    {
      id: 'generate', icon: 'file',
      title: 'Export and upload',
      text: 'Export the file, check it, and upload it in the marketplace portal. Tomorrow’s marketplace file shows if the problems are gone.',
      action: { label: 'Open Update files', view: 'update-files' },
    },
  ] satisfies LoopStep[],

  screens: [
    { term: 'Dashboard', meaning: 'What is wrong today, for each marketplace. The “Talabat vs Snoonu” card compares the two marketplaces with each other.' },
    { term: 'Uploads', meaning: 'Upload your ERP file and the marketplace files.' },
    { term: 'Update files', meaning: 'The main screen. Three steps: Review, Adjust and Export.' },
    { term: 'Generated files', meaning: 'Every file Qorloop has made, ready to download again.' },
    { term: 'Catalogue', meaning: 'All your products. Edit one product, change many at once, set offers or block products.' },
    { term: 'Pricing', meaning: 'Your pricing rules. They decide the price each product should have on a marketplace.' },
  ] satisfies Term[],
  screensNote: 'Catalogue, Pricing and the other admin screens are in the Admin menu.',

  words: [
    { term: 'Available but out of stock', meaning: 'Customers can order items you cannot deliver. Fix these first.', urgent: true },
    { term: 'Lost sales', meaning: 'You have stock, but the marketplace shows the product as unavailable.' },
    { term: 'Price problem', meaning: 'The marketplace price is not the price your pricing rules give.' },
    { term: 'Not listed', meaning: 'The product is in your catalogue but not in the marketplace file.' },
    { term: 'Missing from ERP', meaning: 'The product is in the marketplace file but not in your ERP file.' },
    { term: 'New', meaning: 'A new product from the ERP that is waiting to be activated.' },
    { term: 'Out of date', meaning: 'The uploaded file is older than the limit you set in Settings.' },
    { term: 'Stock conflict', meaning: 'The ERP changed a stock that someone had edited by hand. The edited value stays until you choose.' },
  ] satisfies Term[],

  /** Also shown on Review, Export and wherever the ERP price can be picked. */
  compareWarning: 'Never upload a file made against the ERP price to a real marketplace.',

  situationsIntro: 'Open a question to see the steps.',
  situations: [
    {
      id: 'stock-wrong', title: 'Fix stock or a price on a marketplace',
      steps: [
        'Upload a fresh file from that marketplace.',
        'Open Update files and choose the marketplace.',
        'In Adjust, change the stock or price of the product.',
        'Export the file and upload it in the marketplace portal.',
      ],
    },
    {
      id: 'fill-from', title: 'Copy values from one marketplace to the other',
      steps: [
        'Open Update files, choose the marketplace to change, and go to Adjust.',
        'Under Fill from, choose the other marketplace.',
        'Check the preview, then apply.',
      ],
    },
    {
      id: 'compare', title: 'Compare Talabat and Snoonu',
      steps: [
        'On the Dashboard, look at the Talabat vs Snoonu card.',
        'Or open the Catalogue and use Compare with to show one or both marketplaces next to your own values.',
      ],
    },
    {
      id: 'bulk-offer', title: 'Put many products on offer',
      steps: [
        'Open the Catalogue and tick the products.',
        'Choose Bulk offer.',
        'Enter the offer price, or Off %, and the start and end dates. You can use the same values for every row.',
        'Check the preview, then apply.',
      ],
    },
    {
      id: 'new-products', title: 'Add new products from the ERP',
      steps: [
        'Open the upload and look at the new products in its Changes list.',
        'Open the new products in the Catalogue.',
        'Check each one and activate it.',
      ],
    },
    {
      id: 'block-product', title: 'Hide an old or seasonal product',
      steps: [
        'Open the Catalogue, then choose Block on the product, or tick several rows and choose Block.',
        'Choose a reason: Old product, Seasonal or Other. Check the preview, then confirm.',
        'A blocked product is left out of the Dashboard, the files and all bulk changes.',
        'To bring it back, open the Blocked tab and choose Unblock. Offers that ended do not come back.',
      ],
    },
    {
      id: 'stock-conflict', title: 'Solve a stock conflict',
      steps: [
        'Open Stock conflicts from the Dashboard.',
        'Choose Use ERP to follow the ERP again, or Keep mine to keep the edited value.',
      ],
    },
    {
      id: 'file-rejected', title: 'Upload a file Qorloop does not recognise',
      steps: [
        'Open the upload. Qorloop asks you to map its columns.',
        'Choose which column holds each value, then give the mapping a name. Qorloop remembers it for next time.',
        'If a row has errors, choose Download errors (.xlsx), fix the rows and upload the file again.',
      ],
    },
    {
      id: 'mistake', title: 'Undo a mistake',
      steps: [
        'There is no single undo button. Open Activity to see the old value.',
        'For a price, use Go back to the ERP price rules. For stock, use Reset to ERP.',
        'To undo a bulk change, run another bulk change that puts the old values back.',
      ],
    },
  ] satisfies Situation[],

  rolesIntro: 'Your role decides what you can do. An Owner or Admin can change roles in Team.',
  rolesActionHeader: 'What you can do',
  roleCellYes: 'Yes',
  roleCellNo: 'No',
  roleCellIfAllowed: 'If allowed in Settings',
  roleFootnote: '“If allowed in Settings” means an Owner or Admin can turn on “Allow Analysts to export reports”.',
  roles: [
    {
      id: 'view', label: 'See everything and download generated files',
      permissions: ['recon.view', 'reports.view', 'products.view', 'uploads.view', 'files.view', 'files.download', 'activity.view'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: true },
    },
    {
      id: 'export', label: 'Export reports',
      permissions: ['reports.export'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: 'if-allowed' },
    },
    {
      id: 'upload', label: 'Upload files and map columns',
      permissions: ['uploads.upload', 'uploads.apply', 'uploads.discard', 'uploads.map'],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: false },
    },
    {
      id: 'edit', label: 'Fix stock and prices, set offers, block products and make files',
      permissions: [
        'products.edit', 'catalogue.stock_edit', 'pricing.edit', 'pricing.bulk', 'marketplace.values_edit',
        'products.activate', 'categories.manage', 'products.block', 'files.preview', 'files.generate',
      ],
      roles: { owner: true, admin: true, catalogue_manager: true, analyst: false },
    },
    {
      id: 'settings', label: 'Change store settings and manage the team',
      permissions: ['settings.edit', 'marketplaces.edit', 'team.invite', 'team.manage_roles', 'team.remove'],
      roles: { owner: true, admin: true, catalogue_manager: false, analyst: false },
    },
    {
      id: 'security', label: 'Change security settings',
      permissions: ['settings.security'],
      roles: { owner: true, admin: false, catalogue_manager: false, analyst: false },
    },
  ] satisfies RoleCapability[],

  glossary: [
    { term: 'ERP', meaning: 'Your own stock and sales system. Its file is the source of truth for stock.' },
    { term: 'Marketplace', meaning: 'A delivery app that sells your products, such as Talabat or Snoonu.' },
    { term: 'Catalogue', meaning: 'Qorloop’s copy of your products, with the stock and prices you can adjust.' },
    { term: 'My pricing', meaning: 'The price your pricing rules give a product. Qorloop compares marketplace prices with it.' },
    { term: 'Offer', meaning: 'A promo price for a set of dates. It comes before every other pricing rule.' },
    { term: 'Blocked', meaning: 'A product you have hidden from comparisons and files, with a reason.' },
    { term: 'Mapping', meaning: 'Which column in your file holds which value. You set it once per file layout.' },
  ] satisfies Term[],

  urgentBadge: 'Urgent',
  onboardingLink: 'New to Qorloop? Read How it works.',
  dashboardEmptyLink: 'How Qorloop works',
} as const;

// The files the home shows, by their path in the repository: the ones that
// show best what a style block can do. They must be files the website
// serves (test/ isn't deployed), and ?file= opens only these. The budget
// and paginated ledger examples stay in the gallery, not here.
export const GROUPS = [
  {
    title: 'Examples',
    files: [
      'examples/elements.cssv',
      'examples/forecast.cssv',
      'examples/markets.cssv',
      'examples/planets.cssv',
      'examples/seats.cssv',
      'examples/nutrition.cssv',
      'examples/invoice.cssv',
      'examples/league.cssv',
    ],
  },
  {
    title: 'Website',
    files: [
      'site/departures.cssv',
      'site/editor/ledger.cssv',
    ],
  },
];

export const FILES = GROUPS.flatMap((g) => g.files);

/** Where a file's unsaved draft is kept in localStorage: this, then its path or "local:" and its name. */
export const DRAFTS = 'cssv-editor:draft:';

/**
 * A repository path as a URL relative to this page. The repository root is
 * the server root locally, and site/ is the root on cssv.dev, where "../.."
 * stops at the root, so both forms work in both places.
 */
export const urlOf = (path) => (path.startsWith('site/') ? `../${path.slice(5)}` : `../../${path}`);

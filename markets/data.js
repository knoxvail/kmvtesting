// ---------------------------------------------------------------
// Market data. Edit here, commit, push.
// Lists start empty on purpose: brokers, LIHTC deals, and IL comps
// get baked in as the CoStar pulls come back. Rows added in the
// browser live in localStorage until they get baked in here.
// ---------------------------------------------------------------
const MARKETS = [
  {
    id: 'slc',
    name: 'Salt Lake City / Provo / Ogden', state: 'UT',
    airports: [
      { code: 'SLC', name: 'Salt Lake City Intl', service: 'Delta (hub), multiple daily', weekly: '21+', verify: false },
    ],
    airportNote: 'Provo is about 45 min south of SLC, Ogden about 40 min north. One flight covers three submarkets.',
    note: 'Utah scores 98/100 on the 2026 landlord regulatory index, the best in the country.',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'dfw',
    name: 'Dallas / Fort Worth', state: 'TX',
    airports: [
      { code: 'DFW', name: 'Dallas Fort Worth Intl', service: 'American (hub), many daily', weekly: '56+', verify: false },
      { code: 'DAL', name: 'Dallas Love Field', service: 'Southwest, daily', weekly: '14+', verify: false },
    ],
    airportNote: 'Two airports, both preferred carriers. Best access on the whole list.',
    note: 'Friendly statute, but 1.90% effective property tax with no appraisal cap on rentals. Underwrite taxes hard. The drive-radius cities are the low-basis play.',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'boi',
    name: 'Boise', state: 'ID',
    airports: [
      { code: 'BOI', name: 'Boise Airport', service: 'Nonstop per screen', weekly: 'confirm', verify: true },
    ],
    airportNote: 'Nonstop made the screen. Confirm current carrier and days flown before booking a trip.',
    note: 'Idaho is 96/100 on the landlord index, second only to Utah. Low basis, thin institutional competition.',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'aus',
    name: 'Austin', state: 'TX',
    airports: [
      { code: 'AUS', name: 'Austin-Bergstrom Intl', service: 'Southwest', weekly: 'confirm', verify: true },
    ],
    airportNote: 'Confirm current schedule before booking a trip.',
    note: 'Same Texas tax caveat as Dallas: good statute, 1.90% effective rate, no rental appraisal cap.',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'sat',
    name: 'San Antonio', state: 'TX',
    airports: [
      { code: 'SAT', name: 'San Antonio Intl', service: 'Southwest', weekly: 'confirm', verify: true },
    ],
    airportNote: 'Confirm current schedule before booking a trip.',
    note: 'Split out from Austin on the final sheet. Same Texas tax caveat, cheaper basis of the two.',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'den',
    name: 'Denver / Colorado Springs', state: 'CO',
    airports: [
      { code: 'DEN', name: 'Denver Intl', service: 'Southwest + United, multiple daily', weekly: '40+', verify: false },
      { code: 'COS', name: 'Colorado Springs', service: 'Nonstop, 2x weekly only', weekly: '2', verify: false },
    ],
    airportNote: 'Denver has the flights. The Springs nonstop runs twice a week, which is why booking sites show connections most days.',
    note: 'Denver has the access, Colorado Springs has the profile, and neither has both.',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'clt',
    name: 'Charlotte', state: 'NC',
    airports: [
      { code: 'CLT', name: 'Charlotte Douglas Intl', service: 'American, daily', weekly: '7+', verify: false },
    ],
    airportNote: 'American hub, easy access.',
    note: 'NC House Bill 1042 would close the affordable housing property tax exemption for acquisitions of existing affordable properties. That is our exact structure. Track the bill.',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'hou',
    name: 'Houston', state: 'TX',
    airports: [
      { code: 'HOU', name: 'Houston Hobby', service: 'Southwest, daily', weekly: '7+', verify: false },
      { code: 'IAH', name: 'Bush Intercontinental', service: 'United, multiple daily', weekly: '21+', verify: false },
    ],
    airportNote: 'Access was never the issue here.',
    note: 'On the sheet for reference so the reasoning stays visible.',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'sun',
    name: 'Sun Valley', state: 'ID',
    airports: [
      { code: 'SUN', name: 'Friedman Memorial (Hailey)', service: 'No SNA nonstop', weekly: '0', verify: false },
    ],
    airportNote: 'Connect through SLC, or drive about 2.5 hours from Boise.',
    note: 'Rides along with Boise trips rather than standing on its own.',
    brokers: [], deals: [], il: [],
  },
];

const LISTS = {
  brokers: {
    title: 'Brokers & owners',
    unitField: null,
    fields: [
      { k: 'name', label: 'Name' },
      { k: 'firm', label: 'Firm' },
      { k: 'contact', label: 'Contact' },
      { k: 'note', label: 'Note' },
    ],
    empty: 'None logged. Feeds from the CoStar broker and owner pulls.',
  },
  deals: {
    title: 'LIHTC deals in the MSA',
    unitField: 'units',
    fields: [
      { k: 'property', label: 'Property' },
      { k: 'city', label: 'City / submarket' },
      { k: 'units', label: 'Units' },
      { k: 'note', label: 'Note' },
    ],
    empty: 'None logged. City plus surrounding suburbs, MSA level.',
  },
  il: {
    title: 'Non-LIHTC IL, 150+ units',
    unitField: 'units',
    fields: [
      { k: 'property', label: 'Property' },
      { k: 'city', label: 'City' },
      { k: 'units', label: 'Units' },
      { k: 'note', label: 'Note' },
    ],
    empty: 'None logged. Independent living only, 150 units and up.',
  },
};

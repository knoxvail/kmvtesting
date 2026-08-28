// ---------------------------------------------------------------
// Market data. Edit here, commit, push. One city per entry.
// Lists start empty on purpose: brokers, LIHTC deals, and IL comps
// get baked in as the CoStar pulls come back. Rows added in the
// browser live in localStorage until they get baked in here.
// Notes live in Notion; the site reads them through /api/notes.
// ---------------------------------------------------------------
const MARKETS = [
  {
    id: 'phx',
    name: 'Phoenix', state: 'AZ',
    airports: [
      { code: 'PHX', name: 'Phoenix Sky Harbor', service: 'American (hub) + Southwest, many daily', weekly: '56+', verify: false },
    ],
    airportNote: 'Both preferred carriers, all-day schedule. Access on par with Dallas.',
    note: 'Was the top-ranked market on the original screen before the final cut. Back on the board.',
    notion: 'https://app.notion.com/p/3c9c40abce3981428547fb6475a808a1',
    brokers: [
      {
        name: 'Daniel Diaz',
        firm: 'Walker & Dunlop, Seniors Housing Sales (Assoc. Director)',
        contact: 'daniel.diaz@walkerdunlop.com · cell 480-586-5647',
        note: 'Phoenix based, national coverage. Cold-wrote Blake, forwarded 8/27. The ask: where debt is coming due on 1990s senior LIHTC deals and who is prepping to sell.',
      },
      {
        name: 'Marshall Urban Development',
        firm: 'Owner / developer, Encore on First',
        contact: '(480) 966-3008',
        note: 'In since 2016, CREA syndicated. The call is whether they sell at Y15 or resyndicate themselves.',
      },
    ],
    deals: [
      {
        property: '25 W 1st Ave - Encore on First',
        city: 'Mesa · Downtown Mesa',
        units: '81',
        note: 'Built 2013, Y15 lands ~2028. 4-star, 55+ segment, rent restricted. PacifiCap manages. 1.2% vacancy vs 11.6% submarket. Taxes $15.54/unit on the affordable valuation. Light rail 0.3 mi.',
      },
      {
        property: 'Westward Ho',
        city: '618 N Central Ave, Phoenix',
        units: '290',
        note: 'PIS 2004, 4% credit, Y15 2019. Historic downtown senior tower, HUD-assisted. From HUD LIHTC db, CoStar workup pending.',
      },
      {
        property: 'Deer Valley Gardens',
        city: 'Sun City West',
        units: '164',
        note: 'PIS 2005, Y15 2020. Not elderly-flagged in HUD data but it sits in Sun City West. From HUD LIHTC db, CoStar workup pending.',
      },
      {
        property: 'Memorial Towers',
        city: '1401 S 7th Ave, Phoenix',
        units: '153',
        note: 'PIS 2006, 9%, nonprofit sponsor, Y15 2021. From HUD LIHTC db, CoStar workup pending.',
      },
      {
        property: 'Paradise Palms Senior Housing',
        city: '304 W Southern Ave, Phoenix',
        units: '104',
        note: 'PIS 1999, Y15 2014, a decade past compliance. Sister property Paradise Palms Multi (110u, 2001, nonprofit) is next door at 250 W Southern. From HUD LIHTC db.',
      },
      {
        property: 'Senior Cottage Apts of Apache Junction',
        city: 'Apache Junction',
        units: '92',
        note: 'PIS 1999, 9%, Y15 2014. From HUD LIHTC db, CoStar workup pending.',
      },
      {
        property: 'Rosa Linda Senior Apts',
        city: '10245 N 87th Ave, Peoria',
        units: '84',
        note: 'PIS 2007, 4% credit, Y15 2022. From HUD LIHTC db, CoStar workup pending.',
      },
      {
        property: 'Roeser Senior Village',
        city: '454 E Roeser Rd, Phoenix',
        units: '80',
        note: 'PIS 2002, 9%, nonprofit sponsor, Y15 2017. From HUD LIHTC db, CoStar workup pending.',
      },
      {
        property: 'Apache ASL Trails',
        city: '2428 E Apache Blvd, Tempe',
        units: '75',
        note: 'PIS 2011, Y15 2026. Deaf-accessible senior community on the light rail. Pipeline, not ripe yet. From HUD LIHTC db.',
      },
    ],
    il: [],
  },
  {
    id: 'slc',
    name: 'Salt Lake City', state: 'UT',
    airports: [
      { code: 'SLC', name: 'Salt Lake City Intl', service: 'Delta (hub), multiple daily', weekly: '21+', verify: false },
    ],
    airportNote: 'Best-served airport on the list after Dallas.',
    note: 'Utah scores 98/100 on the 2026 landlord regulatory index, the best in the country.',
    notion: 'https://app.notion.com/p/3c9c40abce398102bea2c1e40ee26968',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'provo',
    name: 'Provo', state: 'UT',
    airports: [
      { code: 'SLC', name: 'Salt Lake City Intl', service: 'Fly SLC, drive ~45 min south', weekly: '21+', verify: false },
      { code: 'PVU', name: 'Provo Municipal', service: 'No SNA service', weekly: '0', verify: false },
    ],
    airportNote: 'Covered off the SLC flight.',
    note: 'Same Utah regulatory picture as Salt Lake, one notch further from the airport.',
    notion: 'https://app.notion.com/p/3c9c40abce3981039cf8c270dfd29a01',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'ogden',
    name: 'Ogden', state: 'UT',
    airports: [
      { code: 'SLC', name: 'Salt Lake City Intl', service: 'Fly SLC, drive ~40 min north', weekly: '21+', verify: false },
      { code: 'OGD', name: 'Ogden-Hinckley', service: 'No scheduled service that matters', weekly: '0', verify: false },
    ],
    airportNote: 'Covered off the SLC flight.',
    note: 'Same Utah regulatory picture. The Tulsa-type profile of the three Wasatch Front cities.',
    notion: 'https://app.notion.com/p/3c9c40abce39814a9e71c866a7504738',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'dfw',
    name: 'Dallas', state: 'TX',
    airports: [
      { code: 'DFW', name: 'Dallas Fort Worth Intl', service: 'American (hub), many daily', weekly: '56+', verify: false },
      { code: 'DAL', name: 'Dallas Love Field', service: 'Southwest, daily', weekly: '14+', verify: false },
    ],
    airportNote: 'Two airports, both preferred carriers. Best access on the whole list.',
    note: 'Friendly statute, but 1.90% effective property tax with no appraisal cap on rentals. Underwrite taxes hard. The drive-radius cities are the low-basis play.',
    notion: 'https://app.notion.com/p/3c9c40abce3981f59604cdac2241f68e',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'ftw',
    name: 'Fort Worth', state: 'TX',
    airports: [
      { code: 'DFW', name: 'Dallas Fort Worth Intl', service: 'American (hub), many daily', weekly: '56+', verify: false },
    ],
    airportNote: 'DFW sits between the two cities, about 25 min to downtown Fort Worth.',
    note: 'Same Texas tax caveat as Dallas. Cheaper basis than the Dallas side of the metro.',
    notion: 'https://app.notion.com/p/3c9c40abce39818c8fd4c27edeced9ec',
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
    notion: 'https://app.notion.com/p/3c9c40abce39813d9cc6cb907bc56551',
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
    notion: 'https://app.notion.com/p/3c9c40abce3981da9fbddb5e648ca559',
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
    notion: 'https://app.notion.com/p/3c9c40abce3981919d4cf071b9adf3ff',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'den',
    name: 'Denver', state: 'CO',
    airports: [
      { code: 'DEN', name: 'Denver Intl', service: 'Southwest + United, multiple daily', weekly: '40+', verify: false },
    ],
    airportNote: 'No access problem here.',
    note: 'Denver has the access. The basis and the competition are the question.',
    notion: 'https://app.notion.com/p/3c9c40abce3981229f82e97c2a5f5949',
    brokers: [], deals: [], il: [],
  },
  {
    id: 'cos',
    name: 'Colorado Springs', state: 'CO',
    airports: [
      { code: 'COS', name: 'Colorado Springs', service: 'Nonstop, 2x weekly only', weekly: '2', verify: false },
    ],
    airportNote: 'The nonstop runs twice a week, which is why booking sites show connections most days. DEN is a ~70 min drive.',
    note: 'Has the profile, not the flights. Workable as a Denver drive-down.',
    notion: 'https://app.notion.com/p/3c9c40abce398161a42bed1da63ced7c',
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
    notion: 'https://app.notion.com/p/3c9c40abce39819ea016eb9853e3404f',
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
    notion: 'https://app.notion.com/p/3c9c40abce39811e8ba7e19ba9d7abc3',
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
    notion: 'https://app.notion.com/p/3c9c40abce3981ee8df6e8df529a6dc0',
    brokers: [], deals: [], il: [],
  },
];

const LISTS = {
  deals: {
    title: 'LIHTC',
    unitField: 'units',
    fields: [
      { k: 'property', label: 'Property' },
      { k: 'city', label: 'City / submarket' },
      { k: 'units', label: 'Units' },
      { k: 'note', label: 'Note' },
    ],
    empty: 'None logged. LIHTC properties in the city and surrounding MSA.',
  },
  il: {
    title: 'Standard SL',
    unitField: 'units',
    fields: [
      { k: 'property', label: 'Property' },
      { k: 'city', label: 'City' },
      { k: 'units', label: 'Units' },
      { k: 'note', label: 'Note' },
    ],
    empty: 'None logged. Standard senior living, 150 units and up, no LIHTC.',
  },
  brokers: {
    title: 'Brokers',
    unitField: null,
    fields: [
      { k: 'name', label: 'Name' },
      { k: 'firm', label: 'Firm' },
      { k: 'contact', label: 'Contact' },
      { k: 'note', label: 'Note' },
    ],
    empty: 'None logged. Feeds from the CoStar broker and owner pulls.',
  },
};

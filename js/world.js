/* ============================================================
   THE WORLD OF MERIDIA
   The map is authored, not random: every country is a set of
   discs at fixed coordinates, so the labels always sit on land.
   ============================================================ */
window.POLITIES = [
  { id: 'MERIDIA', name: 'MERIDIA', role: 'You',
    desc: 'Big, getting bigger. Third economy in the world.',
    color: '#e6c476', lat: 40, lng: -25,
    discs: [[40, -25, 0.27], [32, -13, 0.17], [47, -33, 0.13]] },

  { id: 'ASHKARR', name: 'ASHKARR', role: 'The old superpower',
    desc: 'Ran the world for 90 years. Navy everywhere. Slowing down.',
    color: '#d9903f', lat: 33, lng: -95,
    discs: [[33, -95, 0.29], [19, -87, 0.19], [45, -104, 0.14]] },

  { id: 'VHELM', name: 'VHELM', role: 'Your rival',
    desc: 'Army, not navy. Growing 4.6% a year. Wants a bigger say.',
    color: '#e2573c', lat: 61, lng: 22,
    discs: [[61, 22, 0.28], [51, 37, 0.19], [67, 6, 0.15]] },

  { id: 'SARNIA', name: 'SARNIA', role: 'The small country in between',
    desc: 'Six million people, no real army, sitting on the road between you and Vhelm.',
    color: '#63a8c9', lat: 51, lng: -5,
    discs: [[51, -5, 0.095]] },

  { id: 'THRENE', name: 'THRENE', role: 'Your southern neighbour',
    desc: 'Has the deep-water port everyone wants.',
    color: '#4ec9a0', lat: -12, lng: 25,
    discs: [[-12, 25, 0.21], [-22, 15, 0.13]] },

  { id: 'TIER', name: 'SOUTHERN TIER', role: 'The poorer states',
    desc: 'Sell raw materials, buy finished goods, write none of the rules.',
    color: '#9280d8', lat: -10, lng: -55,
    discs: [[-10, -55, 0.24], [-24, -42, 0.16], [4, -66, 0.13]] }
];

/* Places that are not countries: a sea gate and an institution. */
window.SITES = [
  { id: 'KALOS', name: 'KALOS STRAITS', role: 'Sea gate',
    desc: '60% of your energy comes through this gap.',
    color: '#6fd3f2', lat: 22, lng: 33, kind: 'strait' },
  { id: 'CONCORDAT', name: 'THE CONCORDAT', role: 'The world body',
    desc: 'Where 54 states vote and 112 states do not.',
    color: '#cfd9e4', lat: 44, lng: -12, kind: 'hall' }
];

window.PLACE = {};
[].concat(window.POLITIES, window.SITES).forEach(p => window.PLACE[p.id] = p);

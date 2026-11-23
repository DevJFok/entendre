/* Entendre puzzles. Plain browser script; defines global `Puzzles`. */
(function (root) {
  'use strict';
  var pool = [
    ['Colors', 'color'], ['Foods', 'food'], ['Animals', 'animal'], ['Fruits', 'fruit'], ['Vehicles', 'vehicle'],
    ['Musical instruments', 'musical instrument'], ['Birds', 'bird'], ['Countries', 'country'], ['Sports', 'sport'],
    ['Tools', 'tool'], ['Flowers', 'flower'], ['Trees', 'tree'], ['Dogs', 'dog'], ['Furniture', 'furniture'],
    ['Weather', 'weather'], ['Body parts', 'body part'], ['Clothing', 'clothing'], ['Boats', 'boat'],
    ['Cheeses', 'cheese'], ['Drinks', 'drink'], ['Metals', 'metal'], ['Gems', 'gem'], ['Desserts', 'dessert'],
    ['Insects', 'insect'], ['Fish', 'fish'], ['Kitchen items', 'kitchen utensil'], ['Fabrics', 'fabric'],
    ['Shapes', 'shape'], ['Planets', 'planet'], ['Herbs', 'herb'], ['Spices', 'spice'], ['Jobs', 'job'],
    ['Weapons', 'weapon'], ['Hats', 'hat'], ['Cars', 'car'], ['Cities', 'city'], ['Rivers', 'river'],
    ['Mountains', 'mountain'], ['Dances', 'dance'], ['Board games', 'board game'], ['Plants', 'plant'],
    ['Cooking methods', 'cooking'], ['Vegetables', 'vegetable'], ['Nuts', 'nut'], ['Mammals', 'mammal'],
    ['Reptiles', 'reptile'], ['Shoes', 'shoe'], ['Breads', 'bread'], ['Candy', 'candy'], ['Ships', 'ship']
  ].map(function (p) { return { label: p[0], term: p[1] }; });

  function hashString(s) { // FNV-1a 32-bit
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Pairs verified to share at least 3 everyday words (so each pair has viable entendres).
  // Built offline from the WordNet data. Random draws only use these pairs.
  var VIABLE = ["color|food","color|animal","color|fruit","color|tree","color|clothing","color|drink","color|metal","color|gem","color|river","color|plant","color|mammal","food|animal","food|fruit","food|bird","food|tree","food|drink","food|fish","food|herb","food|spice","food|river","food|plant","food|vegetable","food|mammal","animal|bird","animal|clothing","animal|insect","animal|fish","animal|plant","animal|mammal","animal|reptile","fruit|tree","fruit|plant","fruit|nut","vehicle|boat","vehicle|car","flower|plant","tree|spice","tree|plant","tree|nut","body part|plant","clothing|mammal","drink|plant","herb|plant","spice|plant","plant|vegetable","plant|nut"];
  var byTerm = {};
  pool.forEach(function (p) { byTerm[p.term] = p; });
  // Hand-picked puzzles for specific dates, as 'YYYY-MM-DD': ['termA', 'termB']. These override the random draw.
  var schedule = { '2026-11-22': ['color', 'food'], '2026-11-23': ['water', 'talking'] }; // 11-22: Colors + Foods demo. 11-23: Water + Talking test pair (needs word sheet)

  // Adds categories from the word sheet. A new pair is viable when the two curated lists share at least 3 words.
  function addCategories(cats, curated) {
    cats.forEach(function (c) {
      if (byTerm[c.term]) return;
      pool.push(c); byTerm[c.term] = c;
    });
    cats.forEach(function (c) {
      pool.forEach(function (d) {
        if (d.term === c.term || !curated[c.term] || !curated[d.term]) return;
        var shared = 0;
        curated[c.term].forEach(function (w) { if (curated[d.term].has(w)) shared++; });
        var key = c.term + '|' + d.term, rev = d.term + '|' + c.term;
        if (shared >= 3 && VIABLE.indexOf(key) < 0 && VIABLE.indexOf(rev) < 0) VIABLE.push(key);
      });
    });
  }

  function dailyPuzzle(dateString) {
    var rnd = mulberry32(hashString('entendre:' + dateString));
    var a, b;
    var pinned = schedule[dateString];
    if (pinned && byTerm[pinned[0]] && byTerm[pinned[1]]) {
      a = byTerm[pinned[0]]; b = byTerm[pinned[1]];
    } else {
      var pair = VIABLE[Math.floor(rnd() * VIABLE.length)].split('|');
      a = byTerm[pair[0]]; b = byTerm[pair[1]];
      if (rnd() < 0.5) { var t = a; a = b; b = t; } // randomize which category is A
    }
    return { categoryA: { label: a.label, term: a.term }, categoryB: { label: b.label, term: b.term } };
  }
  // Endless mode: the pair of curated categories with the most shared words. Pairs where one category contains
  // the other (fruit inside food) are skipped, and ties go to the pair with more entries in total.
  function bestPair(curated) {
    var terms = Object.keys(curated).filter(function (t) { return curated[t] && curated[t].size >= 3; });
    var best = null;
    for (var i = 0; i < terms.length; i++) {
      for (var j = i + 1; j < terms.length; j++) {
        var a = terms[i], b = terms[j], sa = curated[a].size, sb = curated[b].size;
        var shared = 0;
        curated[a].forEach(function (w) { if (curated[b].has(w)) shared++; });
        if (shared < 3 || shared === Math.min(sa, sb)) continue;
        var total = sa + sb;
        if (!best || shared > best.shared || (shared === best.shared && total > best.total)) {
          best = { pair: [a, b], shared: shared, total: total };
        }
      }
    }
    return best ? best.pair : null;
  }

  root.Puzzles = { pool: pool, dailyPuzzle: dailyPuzzle, addCategories: addCategories, bestPair: bestPair, schedule: schedule, VIABLE: VIABLE };
})(typeof window !== 'undefined' ? window : globalThis);

// Entendre scoring: plain browser script, defines global `Scoring`.
var Scoring = (function () {
  function createState() {
    return { submitted: [], aOnlyCount: 0, bOnlyCount: 0, entendreCount: 0, basePoints: 0, multiplier: 0 };
  }

  function submitWord(state, rawWord, fitA, fitB) {
    var word = String(rawWord == null ? '' : rawWord).trim().toLowerCase();
    if (!word) return { accepted: false, reason: 'empty', type: null };
    if (state.submitted.indexOf(word) !== -1) return { accepted: false, reason: 'duplicate', type: null };
    if (!fitA && !fitB) return { accepted: false, reason: 'nofit', type: null };

    var type;
    // Each valid word counts in exactly one category: entendre (both), A only, or B only.
    if (fitA && fitB) {
      type = 'AB';
      state.entendreCount++;
      state.basePoints += 10;
      state.multiplier += 1;      // an entendre also raises the B multiplier by one; it still doubles the total
    } else if (fitA) {
      type = 'A';
      state.aOnlyCount++;
      state.basePoints += 10;
    } else {
      type = 'B';
      state.bOnlyCount++;
      state.multiplier += 1;
    }
    state.submitted.push(word);
    return { accepted: true, reason: null, type: type };
  }

  function total(state) {
    return state.basePoints * state.multiplier * Math.pow(2, state.entendreCount);
  }

  function breakdown(state) {
    return {
      aOnlyCount: state.aOnlyCount,
      aOnlyPoints: state.aOnlyCount * 10 + state.entendreCount * 10,
      bOnlyCount: state.bOnlyCount,
      entendreCount: state.entendreCount,
      multiplier: state.multiplier,
      entendreMultiplier: Math.pow(2, state.entendreCount),
      total: total(state)
    };
  }

  // Smooth density of the logged scores (Gaussian kernels, Silverman bandwidth), evaluated at each x.
  // Returns an array the same length as xs. Empty input gives all zeros.
  function density(values, xs) {
    var n = values.length;
    if (!n) return xs.map(function () { return 0; });
    var mean = values.reduce(function (t, v) { return t + v; }, 0) / n;
    var sd = Math.sqrt(values.reduce(function (t, v) { return t + (v - mean) * (v - mean); }, 0) / n);
    var h = Math.max(1, 1.06 * sd * Math.pow(n, -0.2)); // never narrower than one point
    var norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
    return xs.map(function (x) {
      var s = 0;
      for (var i = 0; i < n; i++) { var z = (x - values[i]) / h; s += Math.exp(-0.5 * z * z); }
      return s * norm;
    });
  }

  // Plain-text lines for a breakdown, shared by the daily results and the private room results.
  function breakdownRows(b) {
    return [
      ['A-only words', b.aOnlyCount + ' (' + (b.aOnlyCount * 10) + ' pts)'],
      ['B-only words', String(b.bOnlyCount)],
      ['Entendre words', b.entendreCount + ' (+' + (b.entendreCount * 10) + ' pts)'],
      ['Entendre multiplier', 'x ' + b.entendreMultiplier]
    ];
  }

  return { createState: createState, submitWord: submitWord, total: total, breakdown: breakdown, density: density, breakdownRows: breakdownRows };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Scoring;

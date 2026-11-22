// Entendre scoring: plain browser script, defines global `Scoring`.
var Scoring = (function () {
  function createState() {
    return { submitted: [], aOnlyCount: 0, bOnlyCount: 0, entendreCount: 0, basePoints: 0, multiplier: 1 };
  }

  function submitWord(state, rawWord, fitA, fitB) {
    var word = String(rawWord == null ? '' : rawWord).trim().toLowerCase();
    if (!word) return { accepted: false, reason: 'empty', type: null };
    if (state.submitted.indexOf(word) !== -1) return { accepted: false, reason: 'duplicate', type: null };
    if (!fitA && !fitB) return { accepted: false, reason: 'nofit', type: null };

    var type;
    if (fitA && fitB) {
      type = 'AB';
      state.entendreCount++;
      state.basePoints += 10;
      state.multiplier += 1;
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
      total: total(state)
    };
  }

  return { createState: createState, submitWord: submitWord, total: total, breakdown: breakdown };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Scoring;

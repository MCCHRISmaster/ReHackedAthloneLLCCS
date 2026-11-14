/**
 * Plain-language explanations of a probe result: for each compared body, why
 * the match is (or isn't) useful for human or rover mission testing.
 * Built only from the numbers in the result, so it stays honest when real
 * data replaces the placeholders.
 */
import { BODIES, METRICS, SCALES } from './config.js';

const fmtLat = (v) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'E' : 'W'}`;
const name = (id) => BODIES[id].label.charAt(0) + BODIES[id].label.slice(1).toLowerCase();
const fmtVal = (m, v) => (v == null ? '—' : `${v.toFixed(m.digits)}${m.unit ? ' ' + m.unit : ''}`);

/** Join ['a','b','c'] → 'a, b and c'. */
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function tierOf(score) {
  if (score >= 0.75) return { id: 'strong', label: 'Strong analog' };
  if (score >= 0.55) return { id: 'partial', label: 'Partial analog' };
  return { id: 'weak', label: 'Weak analog' };
}

/**
 * → { tier, headline, good: [{ metric, text }], gaps: [{ metric, text }], summary }
 */
export function explainMatch(result, targetId) {
  const m = result.matches[targetId];
  const scale = SCALES[result.scale];
  const here = name(result.body), there = name(targetId);
  const where = `${fmtLat(m.lat)}, ${fmtLon(m.lon)}`;
  const tier = tierOf(m.score);

  // Who tests what, depending on direction.
  let headline;
  if (targetId === 'earth') {
    headline = `To rehearse a ${scale.mission} mission at this ${here} spot, the closest place on Earth to test is near ${where}.`;
  } else if (result.body === 'earth') {
    headline = `This Earth spot could stand in for ${there} terrain near ${where} when testing a ${scale.mission} mission.`;
  } else {
    headline = `This ${here} spot is most like ${there} terrain near ${where}, so lessons from one could carry over to the other.`;
  }

  const scored = METRICS.filter((k) => m.parts[k.key] != null)
    .map((k) => ({ k, s: m.parts[k.key], w: k.weight[result.scale] ?? 1 }));
  const good = scored.filter((x) => x.s >= 0.7).sort((a, b) => b.s * b.w - a.s * a.w).slice(0, 3);
  const gaps = scored.filter((x) => x.s < 0.4).sort((a, b) => a.s * b.w - b.s * a.w).slice(0, 3);

  const goodOut = good.map(({ k }) => ({
    metric: k.key,
    text: `${k.plain} is similar (${fmtVal(k, result.values[k.key])} here vs ${fmtVal(k, m.values[k.key])} there), good for testing ${k.uses[result.scale]}.`,
  }));
  const gapOut = gaps.map(({ k }) => ({
    metric: k.key,
    text: `${k.plain} differs (${fmtVal(k, result.values[k.key])} vs ${fmtVal(k, m.values[k.key])}), so ${k.uses[result.scale]} can't be tested realistically here.`,
  }));

  let summary;
  if (tier.id === 'strong') summary = `${tier.label}: most conditions that matter for a ${scale.mission} line up.`;
  else if (tier.id === 'partial') summary = `${tier.label}: useful for some tests, but not a full rehearsal.`;
  else summary = `${tier.label}: conditions are too different for most ${scale.mission} testing.`;
  if (good.length) summary += ` Best for ${list(good.map(({ k }) => k.plain.toLowerCase()))}.`;

  return { tier, headline, good: goodOut, gaps: gapOut, summary };
}

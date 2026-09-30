/**
 * Greek stop names are mostly capitals without accents ("ΠΑΝΕΠΙΣΤΗΜΙΟ"), but
 * people type lowercase with them ("πανεπιστήμιο"), which lowercasing alone never
 * matches. Strip diacritics and fold final sigma so both sides compare equal.
 * Tolerates a missing name: an installed app can still hold an older cached stop
 * list in which a few English names were null.
 */
export const fold = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ');

// Greek letters as Greeklish spells them. Pairs are listed first so the regex
// below prefers them (ου is one sound, not ο then υ).
const GREEK = {
  ου: 'ou', αυ: 'av', ευ: 'ev', ηυ: 'iv', μπ: 'b', ντ: 'd', γκ: 'g', γγ: 'g',
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k',
  λ: 'l', μ: 'm', ν: 'n', ξ: 'ks', ο: 'o', π: 'p', ρ: 'r', σ: 's', τ: 't', υ: 'y',
  φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
const GREEK_LETTERS = new RegExp(Object.keys(GREEK).join('|'), 'g');

// Latin spellings that stand for the same Greek sound collapse to one letter:
// ξ and χ both to x, β and μπ to v, the five ways of writing an "i" to i. Search
// gets slightly looser, and every common spelling of a name meets in the middle.
function collapse(latin) {
  return latin
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/mp|b/g, 'v')
    .replace(/nt/g, 'd')
    .replace(/gk|gg|ng/g, 'g')
    .replace(/ou/g, 'u')
    .replace(/ei|oi|yi|ui|y/g, 'i')
    .replace(/ai/g, 'e')
    .replace(/au|af/g, 'av')
    .replace(/eu|ef/g, 'ev')
    .replace(/w/g, 'o')
    .replace(/c/g, 'k')
    .replace(/(\p{L})\1+/gu, '$1')
    .replace(/ +/g, ' ');
}

// Consonant pairs, and h standing for χ ("hania"), as phonetic Greeklish writes them.
const phonetic = (latin) =>
  latin.replace(/ph/g, 'f').replace(/ch|kh/g, 'x').replace(/th/g, '8').replace(/ks|h|x/g, 'x');

// Greeklish that copies the look of the letters instead: h for η ("panepisthmio"),
// u for υ. Then "th" is τη, not θ, which is written 8.
const visual = (latin) =>
  latin
    .replace(/ph/g, 'f')
    .replace(/ch|kh/g, 'x')
    .replace(/ks|x/g, 'x')
    .replace(/h/g, 'i')
    .replace(/(^|[^o])u/g, '$1i');

const toLatin = (folded) => folded.replace(GREEK_LETTERS, (letters) => GREEK[letters]);

/** A name reduced to how it sounds, so Greek and Greeklish spellings compare equal. */
export const soundOf = (text) => collapse(phonetic(toLatin(fold(text))));

/**
 * What a query may sound like. Latin h is ambiguous (χ in "hania", η in
 * "panepisthmio"), so a query has two readings and matches if either does.
 * Many people type Greek on a Latin keyboard: "panepistimio" found nothing before.
 */
export function soundsOfQuery(query) {
  const latin = toLatin(fold(query));
  return [...new Set([collapse(phonetic(latin)), collapse(visual(latin))])]
    .map((sound) => sound.trim())
    .filter(Boolean);
}

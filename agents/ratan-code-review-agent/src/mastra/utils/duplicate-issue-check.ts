import cosine from "talisman/metrics/cosine";
import tokenizer from "talisman/tokenizers/words";

export function getSimilarity(a: string, b: string): number {
  const tokensA = tokenizer(a.toLowerCase());
  const tokensB = tokenizer(b.toLowerCase());
  return cosine(tokensA, tokensB);
}

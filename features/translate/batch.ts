import type {
  TargetLanguage,
  TranslationBatchOutput,
  TranslationOptions,
  TranslationProvider,
} from "./shared";

const numbers = (text: string): string => (text.match(/\p{N}+(?:[.,]\p{N}+)*/gu) ?? []).join("\0");
const readBatch = (output: string, sources: string[]): string[] | undefined => {
  const lines = output.split(/\r?\n/);
  if (lines.length !== sources.length) return;
  const texts: string[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /^(\d+)\.\s+(.+)$/.exec(line);
    const text = match?.[2]?.trim();
    const source = sources[index];
    if (!match || match[1] !== String(index + 1) || !text || source === undefined) return;
    if (numbers(text) !== numbers(source)) return;
    texts.push(text);
  }
  return texts;
};

export async function translateBatch(
  texts: string[],
  target: TargetLanguage,
  provider: TranslationProvider,
  options: TranslationOptions,
): Promise<TranslationBatchOutput> {
  options.signal.throwIfAborted();
  const quietOptions = { ...options, onText: undefined };
  if (provider.kind === "ollama") {
    const { translateWithOllama } = await import("./ollama");
    const results = await Promise.all(
      texts.map((text) => translateWithOllama(text, target, provider.model, quietOptions)),
    );
    return { texts: results.map((result) => result.text), device: "unknown", provider: "ollama" };
  }
  const { translate } = await import("./engine");
  if (!texts.some((text) => /[\r\n]/.test(text))) {
    try {
      const result = await translate(
        texts.map((text, index) => `${index + 1}. ${text}`).join("\n"),
        target,
        provider.model,
        quietOptions,
      );
      options.signal.throwIfAborted();
      const translated = readBatch(result.text, texts);
      if (translated) return { texts: translated, device: result.device };
    } catch (error) {
      options.signal.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
    }
  }
  options.signal.throwIfAborted();
  const results = await Promise.all(
    texts.map((text) => translate(text, target, provider.model, quietOptions)),
  );
  const first = results[0];
  if (!first) throw new Error("翻訳リクエストが空です。");
  return { texts: results.map((result) => result.text), device: first.device };
}

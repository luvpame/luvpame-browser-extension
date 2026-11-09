import type { TargetLanguage } from "./shared";

export const PROMPT_VERSION = "pfml3-v1";
export const TRANSLATION_STOP = ["<|plamo:tag|>", "<|plamo:bos|>"];
export const translationPrompt = (text: string, target: TargetLanguage): string =>
  "<|plamo:tag|>dataset<|plamo:msg|>translation" +
  (target === "ja-easy"
    ? "<|plamo:tag|>context<|plamo:msg|>読者は日本語学習者です。短い文と日常の言葉を使います。内容は省略・要約しません。"
    : "") +
  "<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>" +
  text.replaceAll("<|", "<\u200b|") +
  "<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja" +
  (target === "ja-easy" ? "<|plamo:key|>form<|plamo:val|>polite" : "") +
  "<|plamo:msg|>";

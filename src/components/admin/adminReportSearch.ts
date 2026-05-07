import { REPORT_REASONS } from "../../../shared/safety/reportReasons";

const REPORT_REASON_SEARCH_STOP_WORDS = new Set(["and", "or", "the", "user", "concern"]);

export const normalizeReportSearchText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const reportReasonSearchIndex = REPORT_REASONS.map((reason) => ({
  id: reason.id,
  idSearch: normalizeReportSearchText(reason.id),
  labelSearch: normalizeReportSearchText(reason.label),
}));

export const resolveReportSearchQuery = (query: string) => {
  const normalized = normalizeReportSearchText(query);
  if (!normalized) return "";

  const exactReason = reportReasonSearchIndex.find(
    (reason) => reason.idSearch === normalized || reason.labelSearch === normalized,
  );
  if (exactReason) return exactReason.id;

  const words = normalized.split(" ");
  if (words.length > 1) {
    const labelPhraseMatch = reportReasonSearchIndex.find((reason) => reason.labelSearch.includes(normalized));
    return labelPhraseMatch?.id ?? query;
  }

  const [word] = words;
  if (word.length >= 4 && !REPORT_REASON_SEARCH_STOP_WORDS.has(word)) {
    const wordMatches = reportReasonSearchIndex.filter((reason) => reason.labelSearch.split(" ").includes(word));
    if (wordMatches.length === 1) return wordMatches[0].id;
  }

  return query;
};

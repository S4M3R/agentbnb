import { trustedHousesitters } from "./trustedhousesitters";
import type { SourceAdapter } from "./types";
import { workaway } from "./workaway";

export const ADAPTERS: Record<string, SourceAdapter> = {
  [trustedHousesitters.sourceId]: trustedHousesitters,
  [workaway.sourceId]: workaway,
};

export type { NormalizedListing, SourceAdapter } from "./types";

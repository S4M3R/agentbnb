import { trustedHousesitters } from "./trustedhousesitters";
import type { SourceAdapter } from "./types";
import { workaway } from "./workaway";
import { worldpackers } from "./worldpackers";

export const ADAPTERS: Record<string, SourceAdapter> = {
  [trustedHousesitters.sourceId]: trustedHousesitters,
  [workaway.sourceId]: workaway,
  [worldpackers.sourceId]: worldpackers,
};

export type { NormalizedListing, SourceAdapter } from "./types";

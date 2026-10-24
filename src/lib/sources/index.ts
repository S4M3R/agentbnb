import { airbnb } from "./airbnb";
import { anyplace } from "./anyplace";
import { apartmentlist } from "./apartmentlist";
import { blueground } from "./blueground";
import { bungalow } from "./bungalow";
import { craigslist } from "./craigslist";
import { facebookGroups } from "./facebook-groups";
import { helpstay } from "./helpstay";
import { helpx } from "./helpx";
import { hiusa } from "./hiusa";
import { homeexchange } from "./homeexchange";
import { homelink } from "./homelink";
import { hostelworld } from "./hostelworld";
import { houseCarers } from "./housecarers";
import { houseSittersAmerica } from "./housesittersamerica";
import { intervac } from "./intervac";
import { kindred } from "./kindred";
import { landing } from "./landing";
import { mindmyhouse } from "./mindmyhouse";
import { nomador } from "./nomador";
import { outsite } from "./outsite";
import { padsplit } from "./padsplit";
import { pasportaServo } from "./pasportaservo";
import { roomi } from "./roomi";
import { roomster } from "./roomster";
import { sabbaticalHomes } from "./sabbaticalhomes";
import { spareroom } from "./spareroom";
import { tripalink } from "./tripalink";
import { trustedHousesitters } from "./trustedhousesitters";
import { volunteersbase } from "./volunteersbase";
import { workaway } from "./workaway";
import { workingtraveller } from "./workingtraveller";
import { worldpackers } from "./worldpackers";
import { wwoofUsa } from "./wwoof-usa";
import { zumper } from "./zumper";
import type { SourceAdapter } from "./types";

/** Every scraper adapter, keyed by its sourceId. */
export const ADAPTERS: Record<string, SourceAdapter> = Object.fromEntries(
  [
    airbnb,
    anyplace,
    apartmentlist,
    blueground,
    bungalow,
    craigslist,
    facebookGroups,
    helpstay,
    helpx,
    hiusa,
    homeexchange,
    homelink,
    hostelworld,
    houseCarers,
    houseSittersAmerica,
    intervac,
    kindred,
    landing,
    mindmyhouse,
    nomador,
    outsite,
    padsplit,
    pasportaServo,
    roomi,
    roomster,
    sabbaticalHomes,
    spareroom,
    tripalink,
    trustedHousesitters,
    volunteersbase,
    workaway,
    workingtraveller,
    worldpackers,
    wwoofUsa,
    zumper,
  ].map((a) => [a.sourceId, a]),
);

export type { NormalizedListing, SourceAdapter } from "./types";

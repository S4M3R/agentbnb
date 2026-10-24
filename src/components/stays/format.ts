export const TYPE_LABEL: Record<string, string> = {
  house_sit: "House sit",
  work_exchange: "Work exchange",
  farm_stay: "Farm stay",
  couch: "Couch",
  private_room: "Private room",
  shared_room: "Shared room",
  entire_place: "Entire place",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Dec 3 – 9", "Dec 28 – Jan 4", or with years when they differ. Inputs are YYYY-MM-DD. */
export function formatRange(start: string, end: string) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = `${MONTHS[sm - 1]} ${sd}`;
  if (sy !== ey) return `${s}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
  if (start === end) return s;
  return sm === em ? `${s} – ${ed}` : `${s} – ${MONTHS[em - 1]} ${ed}`;
}

// Shared by the root layout (a server component) and ReservedSlot (a client component): the names
// of the home sections that reserve space before paint, and the inline script that does it.

export const SLOT_NAMES = ["activity", "notice", "attention", "recent"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** Where a slot's last height is kept, per screen size (phones and wider screens differ). */
export const slotKey = (name: string, wide: boolean) => `abnb:slot:${name}:${wide ? "sm" : "xs"}`;

/** Runs in <head> before paint: sets --slot-<name> on <html> from the heights saved last visit. */
export const SLOT_SCRIPT = `try{var w=innerWidth>=640,s=document.documentElement.style;${JSON.stringify(SLOT_NAMES)}.forEach(function(n){var h=+localStorage.getItem("abnb:slot:"+n+":"+(w?"sm":"xs"))||0;if(h>0)s.setProperty("--slot-"+n,h+"px")})}catch(e){}`;

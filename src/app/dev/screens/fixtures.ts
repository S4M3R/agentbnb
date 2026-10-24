import { buildCalendar } from "@/components/calendar/calendar";
import type { NightsSummary } from "@/components/nights/nights";
import type { StayRequest, Trip } from "@/components/requests/types";
import type { ChatGroup, SidebarUser } from "@/components/shell/sidebar";
import type { StayCardData, StayPanelData } from "@/components/stays/types";

// Sample data for the design screens: a founder planning a Lisbon weekend. All hosts are made up.

const photo = (id: string, w = 900) => `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;
const face = (id: string) => `https://images.unsplash.com/photo-${id}?w=160&h=160&q=70&auto=format&fit=crop&crop=faces`;

export const SCREENS = ["home", "results", "stay", "requests", "calendar"] as const;
export type Screen = (typeof SCREENS)[number];
export const screenHref = (s: Screen) => `/dev/screens/${s}`;

export const user: SidebarUser = { name: "Agustin Alvarez", detail: "Founder · San Francisco", href: "#" };

export const nights: NightsSummary = { balance: 5, pending: 2, note: "Hosting Lena on 6–8 Nov earns 2." };

const hosts = {
  marta: { name: "Marta Alves", photo: face("1494790108377-be9c29b29330") },
  joao: { name: "João Pereira", photo: face("1507003211169-0a1dd7228f2d") },
  ines: { name: "Inês Costa", photo: face("1531123897727-8f129e1688ce") },
  rui: { name: "Rui Santos", photo: face("1599566150163-29194dcaad36") },
  ana: { name: "Ana Lima", photo: face("1580489944761-15a19d654956") },
  tiago: { name: "Tiago Rocha", photo: face("1539571696357-5a69c17a67c6") },
};

export const externalHosts = [hosts.ana, hosts.tiago, hosts.rui];

export const trip: Trip = { title: "Lisbon", dates: "Fri 30 Oct – Sun 1 Nov", photo: photo("1585208798174-6cedd86e019a", 400) };

export const requests: StayRequest[] = [
  {
    id: "r-marta",
    host: hosts.marta,
    area: "Alfama",
    status: "accepted",
    note: "Pastel the cat is ready for you. Come any time after 18:00.",
    noteFrom: "host",
    timeLeft: "3h 40m",
    timeLeftShare: 0.92,
  },
  {
    id: "r-joao",
    host: hosts.joao,
    area: "Príncipe Real",
    status: "interested",
    note: "A founder who surfs. João will like this; he decides tonight.",
    noteFrom: "hostAgent",
    timeLeft: "2h 14m",
    timeLeftShare: 0.56,
  },
  {
    id: "r-ines",
    host: hosts.ines,
    area: "Graça",
    status: "sent",
    note: "Your intro reached her at 18:05.",
    noteFrom: "agent",
    timeLeft: "3h 05m",
    timeLeftShare: 0.77,
  },
];

export const chats: ChatGroup[] = [
  {
    label: "Today",
    chats: [
      { id: "lisbon", title: "Lisbon, founders who surf", href: screenHref("results") },
      { id: "couch", title: "Put my couch up 6–8 Nov", href: screenHref("home") },
    ],
  },
  {
    label: "Previous 7 days",
    chats: [
      { id: "tokyo", title: "Tokyo in August", href: screenHref("home") },
      { id: "berlin", title: "Berlin, card-issuing people", href: screenHref("home") },
      { id: "cats", title: "Cat sits in SF in December", href: screenHref("home") },
      { id: "sonoma", title: "Farm stay near Sonoma", href: screenHref("home") },
    ],
  },
];

export const starters = [
  { title: "Founders who surf", prompt: "Lisbon next weekend, with a founder who surfs", photo: photo("1585208798174-6cedd86e019a", 600) },
  { title: "A couch tonight", prompt: "I just landed in SF and need a couch tonight", photo: photo("1555041469-a586c61ea9bc", 600) },
  { title: "Ride with locals", prompt: "Snowboarders hosting near Tahoe in January", photo: photo("1478700485868-972b69dc3fc4", 600) },
  { title: "Host and earn nights", prompt: "Put my place up the weekend after next", photo: photo("1501594907352-04cda38ebc29", 600) },
];

export const cards: StayCardData[] = [
  {
    id: "marta",
    title: "Spare room with river light",
    place: "Alfama, Lisbon",
    photo: photo("1522708323590-d24dbb6b0267"),
    host: hosts.marta,
    detail: "Marta · payments founder",
    nights: 2,
    badge: "Best match",
    reasons: ["Founder", "Snowboards"],
  },
  {
    id: "joao",
    title: "Couch in a sunny flat",
    place: "Príncipe Real, Lisbon",
    photo: photo("1493809842364-78817add7ffb"),
    host: hosts.joao,
    detail: "João · runs a seed fund",
    nights: 2,
    reasons: ["Founder", "Founder dinners"],
  },
  {
    id: "rui",
    title: "Spare room by the river",
    place: "Santos, Lisbon",
    photo: photo("1595526114035-0d45ed16cfbf"),
    host: hosts.rui,
    detail: "Rui · designer, hosted 22×",
    nights: 2,
    reasons: ["Surfs at dawn"],
  },
];

export const martaPanel: StayPanelData = {
  title: "Spare room with river light",
  subtitle: "Private room in Alfama, Lisbon · 1 guest · approximate location",
  photos: [
    photo("1522708323590-d24dbb6b0267", 1200),
    photo("1484154218962-a197022b5858", 600),
    photo("1631049307264-da0ec9d70304", 600),
    photo("1505693416388-ac5ce068fe85", 600),
    photo("1554995207-c18c203602cb", 600),
  ],
  host: { ...hosts.marta, detail: "Payments founder · hosted 14 times" },
  fit: [
    { icon: "work", title: "Founder, like you", detail: "She hosts founders only, and your profile qualifies." },
    { icon: "sport", title: "You both snowboard", detail: "She rides Serra da Estrela every winter." },
    { icon: "dates", title: "Free on your dates", detail: "Fri 30 Oct – Sun 1 Nov, arrival from 18:00." },
  ],
  rules: ["Shoes off", "Quiet after 23:00", "A cat named Pastel"],
};

// Two places in SF, a Lisbon–Porto trip with one night uncovered, and a December trip still out.
export const calendar = buildCalendar({
  today: "2026-10-24",
  places: [
    {
      id: "mission",
      title: "Couch in the Mission",
      photo: photo("1555041469-a586c61ea9bc", 200),
      open: [
        { start: "2026-11-06", end: "2026-11-15" },
        { start: "2026-11-20", end: "2026-12-06" },
      ],
      blocked: [{ start: "2026-11-16", end: "2026-11-19" }],
    },
    {
      id: "bernal",
      title: "Garden studio, Bernal",
      photo: photo("1505693416388-ac5ce068fe85", 200),
      open: [{ start: "2026-10-26", end: "2026-11-29" }],
      blocked: [{ start: "2026-11-25", end: "2026-11-27" }],
    },
  ],
  guests: [
    { id: "lena", placeId: "mission", name: "Lena Fischer", photo: face("1438761681033-6461ffad8d80"), start: "2026-11-06", end: "2026-11-08", status: "booked", source: "AgentBnB", href: "#" },
    { id: "sam", placeId: "mission", name: "Sam Okafor", start: "2026-11-12", end: "2026-11-15", status: "request", source: "AgentBnB", href: "#" },
    { id: "kai", placeId: "mission", name: "Kai Tanaka", photo: face("1500648767791-00dcc994a43e"), start: "2026-11-21", end: "2026-11-24", status: "booked", source: "Couchsurfing", href: "#" },
    { id: "priya", placeId: "bernal", name: "Priya Nair", photo: face("1544005313-94ddf0286df2"), start: "2026-11-09", end: "2026-11-14", status: "booked", source: "Trustroots", href: "#" },
    { id: "theo", placeId: "bernal", name: "Theo Martin", start: "2026-11-17", end: "2026-11-19", status: "request", source: "BeWelcome", href: "#" },
  ],
  stays: [
    { id: "marta", title: "Spare room with river light", where: "Alfama, Lisbon", host: "Marta", photo: photo("1522708323590-d24dbb6b0267", 200), start: "2026-10-30", end: "2026-11-01", status: "confirmed", href: screenHref("requests") },
    { id: "rui", title: "Room by the Douro", where: "Ribeira, Porto", host: "Rui", photo: photo("1595526114035-0d45ed16cfbf", 200), start: "2026-11-02", end: "2026-11-05", status: "confirmed", href: "#" },
    { id: "tahoe-a", title: "Cabin near Heavenly", where: "South Lake Tahoe", start: "2026-12-18", end: "2026-12-21", status: "pending", href: "#" },
    { id: "tahoe-b", title: "Bunk room in Truckee", where: "Truckee", start: "2026-12-18", end: "2026-12-21", status: "pending", href: "#" },
  ],
});

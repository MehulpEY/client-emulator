// ============================================================================
// The canonical fleet — one deterministic organization that every
// inventory-bearing tool projects into its own vendor schema (PLAN §4.4).
// Because CrowdStrike, Qualys, Meraki, Entra, Trellix (and the scaffold
// adapters) all draw from THIS data, cross-adapter correlation on
// serial/mac/hostname/email genuinely works end-to-end.
//
// Deterministic: same fleetId => same identifiers, forever. Seeded with the
// same mulberry32 PRNG the crafted tools use.
// ============================================================================

import { rng, pick, int, chance, type RNG } from "../tools/helpers";

export interface FleetUser {
  fleetId: string;        // "usr-001"
  displayName: string;
  upn: string;            // also the email
  department: string;
  title: string;
  site: string;
  enabled: boolean;
}

export interface FleetDevice {
  fleetId: string;        // "dev-001"
  hostname: string;       // e.g. "LT-FIN-012"
  mac: string;            // canonical lowercase aa:bb:cc:dd:ee:ff
  serial: string;
  os: string;             // e.g. "Windows 11 Pro 23H2"
  platform: "windows" | "mac" | "linux" | "network";
  ip: string;             // stable 10.x address
  site: string;
  ownerFleetId?: string;  // -> FleetUser.fleetId (endpoints only)
  tags: string[];
}

/** Canonical org identifiers referenced by fetchStep pathParams (PLAN §4.4). */
export const FLEET_ORG = {
  company: "Meridian Dynamics",
  domain: "meridiandynamics.example",
  merakiOrgId: "org-emu-1",
  merakiNetworkId: "net-emu-1",
  zpaCustomerId: "emu-cust-1",
} as const;

export const FLEET_SITES = ["NYC-HQ", "LON-01", "SG-02", "REMOTE"] as const;

const FIRST = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Ethan", "Ivy", "Lucas", "Nina", "Owen",
  "Priya", "Marco", "Sana", "Diego", "Lena", "Kofi", "Yuki", "Omar", "Elsa", "Ravi",
  "Tara", "Felix", "Nadia", "Hugo", "Iris", "Jonas", "Mei", "Andre", "Carla", "Tomas",
  "Aisha", "Erik", "Layla", "Pavel", "Rosa", "Kenji", "Freya", "Samir", "Alba", "Viktor"] as const;
const LAST = ["Sharma", "Kowalski", "Ito", "Fernandez", "Okafor", "Novak", "Bergstrom", "Haddad",
  "Reyes", "Lindqvist", "Tanaka", "Moreau", "Petrov", "Silva", "Ahmed", "Jensen",
  "Castillo", "Nakamura", "Weber", "Osei", "Larsen", "Duval", "Kim", "Rossi",
  "Mbeki", "Ivanova", "Costa", "Yamamoto", "Fischer", "Diallo", "Sorensen", "Rahman",
  "Vargas", "Cheng", "Lund", "Abadi", "Klein", "Sato", "Bianchi", "Nassar"] as const;
const DEPTS = [
  { code: "FIN", name: "Finance", titles: ["Financial Analyst", "Controller", "AP Specialist"] },
  { code: "ENG", name: "Engineering", titles: ["Software Engineer", "Platform Engineer", "QA Engineer"] },
  { code: "SEC", name: "Security", titles: ["Security Analyst", "SOC Engineer", "GRC Lead"] },
  { code: "HR", name: "People Ops", titles: ["HR Partner", "Recruiter", "People Analyst"] },
  { code: "SLS", name: "Sales", titles: ["Account Executive", "Sales Engineer", "SDR"] },
  { code: "OPS", name: "IT Operations", titles: ["SysAdmin", "IT Support Lead", "Network Engineer"] },
] as const;

const WIN_OS = ["Windows 11 Pro 23H2", "Windows 11 Enterprise 24H2", "Windows 10 Enterprise 22H2"] as const;
const MAC_OS = ["macOS 15.3 Sequoia", "macOS 14.7 Sonoma"] as const;
const LINUX_OS = ["Ubuntu 24.04 LTS", "RHEL 9.4", "Debian 12"] as const;
const NET_MODELS = ["MR46 (AP)", "MS250-48 (Switch)", "MX85 (Security Appliance)"] as const;

function macFor(seedKey: string): string {
  const r = rng("mac:" + seedKey);
  const oct = () => int(r, 0, 255).toString(16).padStart(2, "0");
  // Locally-administered unicast prefix keeps fleet macs from colliding with real vendors.
  return `0a:${oct()}:${oct()}:${oct()}:${oct()}:${oct()}`;
}

function serialFor(seedKey: string, platform: FleetDevice["platform"]): string {
  const r = rng("serial:" + seedKey);
  const alnum = (n: number) => Array.from({ length: n }, () => pick(r, [..."ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"] as const)).join("");
  if (platform === "mac") return `C02${alnum(9)}`;                    // Apple style
  if (platform === "network") return `Q2${pick(r, ["AB", "CD", "EF"] as const)}-${alnum(4)}-${alnum(4)}`; // Meraki style
  return `${pick(r, ["5CG", "MJ0", "PF3"] as const)}${alnum(7)}`;     // Dell/Lenovo/HP style
}

function buildUsers(): FleetUser[] {
  const users: FleetUser[] = [];
  for (let i = 1; i <= 40; i++) {
    const id = `usr-${String(i).padStart(3, "0")}`;
    const r = rng("user:" + id);
    const first = pick(r, FIRST);
    const last = pick(r, LAST);
    const dept = pick(r, DEPTS);
    users.push({
      fleetId: id,
      displayName: `${first} ${last}`,
      upn: `${first[0].toLowerCase()}.${last.toLowerCase()}@${FLEET_ORG.domain}`,
      department: dept.name,
      title: pick(r, dept.titles),
      site: pick(r, FLEET_SITES),
      enabled: !chance(r, 0.05),
    });
  }
  return users;
}

function buildDevices(users: FleetUser[]): FleetDevice[] {
  const devices: FleetDevice[] = [];
  let n = 0;
  const add = (platform: FleetDevice["platform"], count: number, make: (r: RNG, i: number) => Partial<FleetDevice> & { hostname: string; os: string }) => {
    for (let i = 0; i < count; i++) {
      n++;
      const id = `dev-${String(n).padStart(3, "0")}`;
      const r = rng("device:" + id);
      const base = make(r, i);
      const owner = platform === "network" || base.hostname.startsWith("SRV-") ? undefined : pick(r, users);
      devices.push({
        fleetId: id,
        mac: macFor(id),
        serial: serialFor(id, platform),
        platform,
        ip: `10.${platform === "network" ? 0 : int(r, 10, 30)}.${int(r, 0, 254)}.${int(r, 2, 250)}`,
        site: owner ? owner.site : pick(r, FLEET_SITES),
        ownerFleetId: owner?.fleetId,
        tags: chance(r, 0.3) ? ["vip"] : [],
        ...base,
      });
    }
  };

  // 30 Windows laptops/workstations named after departments.
  add("windows", 30, (r, i) => {
    const dept = pick(r, DEPTS);
    return { hostname: `LT-${dept.code}-${String(i + 1).padStart(3, "0")}`, os: pick(r, WIN_OS) };
  });
  // 8 Windows servers.
  add("windows", 8, (r, i) => ({ hostname: `SRV-${pick(r, ["DC", "APP", "SQL", "FILE"] as const)}-${String(i + 1).padStart(2, "0")}`, os: "Windows Server 2022 Datacenter" }));
  // 8 Macs.
  add("mac", 8, (r, i) => ({ hostname: `MAC-${pick(r, DEPTS).code}-${String(i + 1).padStart(3, "0")}`, os: pick(r, MAC_OS) }));
  // 6 Linux servers.
  add("linux", 6, (r, i) => ({ hostname: `SRV-LNX-${String(i + 1).padStart(2, "0")}`, os: pick(r, LINUX_OS) }));
  // 8 Meraki network devices.
  add("network", 8, (r, i) => {
    const model = NET_MODELS[i % NET_MODELS.length];
    const kind = model.includes("AP") ? "AP" : model.includes("Switch") ? "SW" : "MX";
    return { hostname: `${kind}-${String(i + 1).padStart(2, "0")}`, os: model };
  });
  return devices;
}

export const FLEET_USERS: readonly FleetUser[] = buildUsers();
export const FLEET_DEVICES: readonly FleetDevice[] = buildDevices([...FLEET_USERS]);

export const fleetUsers = (): readonly FleetUser[] => FLEET_USERS;
export const fleetDevices = (): readonly FleetDevice[] => FLEET_DEVICES;
export const fleetDevice = (fleetId: string): FleetDevice | undefined => FLEET_DEVICES.find((d) => d.fleetId === fleetId);
export const fleetUser = (fleetId: string): FleetUser | undefined => FLEET_USERS.find((u) => u.fleetId === fleetId);
export const ownerOf = (d: FleetDevice): FleetUser | undefined => (d.ownerFleetId ? fleetUser(d.ownerFleetId) : undefined);

/** Endpoint-style devices (what EDR/VM/EPO agents see) — excludes network gear. */
export const fleetEndpoints = (): FleetDevice[] => FLEET_DEVICES.filter((d) => d.platform !== "network");
/** Meraki-style network gear. */
export const fleetNetworkDevices = (): FleetDevice[] => FLEET_DEVICES.filter((d) => d.platform === "network");

// -- identifier format helpers (per-vendor projections use these) ------------
export const macColon = (mac: string): string => mac.toLowerCase();
export const macDashedUpper = (mac: string): string => mac.toUpperCase().replace(/:/g, "-");
export const macBareUpper = (mac: string): string => mac.toUpperCase().replace(/:/g, "");

/** Stable per-tool external id for a fleet member, e.g. extId("crowdstrike", "dev-001"). */
export function extId(toolId: string, fleetId: string, len = 24): string {
  const r = rng(`extid:${toolId}:${fleetId}`);
  const HEXC = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) s += HEXC[int(r, 0, 15)];
  return s;
}

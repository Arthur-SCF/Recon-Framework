/**
 * presets.ts — Predefined scan-profile batch toggles.
 *
 * Each preset maps step_id → enabled (true/false).
 * Steps NOT listed keep their current state.
 * The frontend sends a PUT for each step whose state would change.
 */

export type PresetName = "passive" | "quick" | "full" | "stealth";

export interface Preset {
  name:        PresetName;
  label:       string;
  description: string;
  /** step_id → enabled */
  overrides:   Record<string, boolean>;
}

export const PRESETS: Preset[] = [
  {
    name:        "passive",
    label:       "Passive only",
    description: "Only passive enumeration — no active probing, no port scanning",
    overrides: {
      // Passive enumeration ON
      subfinder:           true,
      amass:               true,
      tlsx:                true,
      assetfinder:         true,
      crt_sh:              true,
      gau:                 true,
      cloud_enum:          true,
      s3scanner:           true,
      wafw00f:             false,

      // DNS — brute-force ON, permutation OFF (no active probing)
      wildcard_check:      true,
      puredns_default:     true,
      alterx:              false,
      puredns_permutation: false,
      cewl:                false,
      puredns_custom:      false,

      // HTTP probing OFF
      httpx_r1:            false,
      httpx_r2:            false,
      httpx_r3:            false,
      httpx_ports:         false,

      // Port scanning OFF
      naabu:               false,

      // Service fingerprinting OFF
      zgrab2_service:      false,
      nmap_service:        false,

      // JS crawl OFF
      katana:              false,
      subdomainizer:       false,

      // Takeover + screenshots OFF
      nuclei_takeover:     false,
      gowitness:           false,
    },
  },
  {
    name:        "quick",
    label:       "Quick scan",
    description: "Fast active scan — key tools only, no exhaustive brute-force",
    overrides: {
      subfinder:           true,
      amass:               false,
      tlsx:                false,
      assetfinder:         true,
      crt_sh:              true,
      gau:                 false,
      cloud_enum:          false,
      s3scanner:           false,
      wafw00f:             false,

      wildcard_check:      true,
      puredns_default:     true,
      alterx:              false,
      puredns_permutation: false,
      cewl:                false,
      puredns_custom:      false,

      httpx_r1:            true,
      httpx_r2:            false,
      httpx_r3:            false,
      httpx_ports:         false,

      naabu:               true,

      zgrab2_service:      true,
      nmap_service:        false,

      katana:              false,
      subdomainizer:       false,

      nuclei_takeover:     true,
      gowitness:           false,
    },
  },
  {
    name:        "full",
    label:       "Full recon",
    description: "Enable everything — comprehensive but slow",
    overrides: Object.fromEntries([
      "subfinder", "amass", "tlsx", "assetfinder", "crt_sh", "gau",
      "cloud_enum", "s3scanner", "wafw00f",
      "wildcard_check", "puredns_default", "alterx", "puredns_permutation",
      "cewl", "puredns_custom",
      "httpx_r1", "httpx_r2", "httpx_r3", "httpx_ports",
      "naabu",
      "zgrab2_service",
      "katana", "subdomainizer",
      "nuclei_takeover", "gowitness",
    ].map(id => [id, true])),
  },
  {
    name:        "stealth",
    label:       "Stealth",
    description: "Passive + slow DNS — avoids active probing and rate-limit triggers",
    overrides: {
      subfinder:           true,
      amass:               false,
      tlsx:                false,
      assetfinder:         true,
      crt_sh:              true,
      gau:                 true,
      cloud_enum:          false,
      s3scanner:           false,
      wafw00f:             false,

      wildcard_check:      true,
      puredns_default:     false,
      alterx:              false,
      puredns_permutation: false,
      cewl:                false,
      puredns_custom:      false,

      httpx_r1:            false,
      httpx_r2:            false,
      httpx_r3:            false,
      httpx_ports:         false,

      naabu:               false,
      zgrab2_service:      false,
      nmap_service:        false,
      katana:              false,
      subdomainizer:       false,
      nuclei_takeover:     false,
      gowitness:           false,
    },
  },
];

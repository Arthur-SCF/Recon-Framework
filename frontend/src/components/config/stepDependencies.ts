/**
 * Upstream dependency map for pipeline steps.
 *
 * STEP_DEPS[step_id] = array of step_ids where ANY ONE must be enabled.
 * If none of the listed deps are enabled, the step will silently produce 0 results.
 * Used exclusively for UI warnings (⚠) — not enforced at runtime.
 */
export const STEP_DEPS: Record<string, string[]> = {
  // HTTP probing — each round needs its feed consolidation step
  httpx_r1:            ["consolidate_r1"],
  httpx_r2:            ["consolidate_r2"],
  httpx_r3:            ["consolidate_r3"],
  httpx_ports:         ["naabu"],

  // Permutation chain
  alterx:              ["consolidate_r1"],
  puredns_permutation: ["alterx"],
  puredns_custom:      ["cewl"],
  consolidate_r2:      ["puredns_permutation", "puredns_custom"],

  // JS crawling — needs at least one HTTP probe round
  katana:              ["httpx_r1", "httpx_r2"],
  subdomainizer:       ["httpx_r1", "httpx_r2"],
  consolidate_r3:      ["katana", "subdomainizer"],

  // Post-probing analysis — all read from live_hosts
  naabu:               ["httpx_r1"],
  nuclei_takeover:     ["httpx_r1"],
  gowitness:           ["httpx_r1"],

  // Service fingerprinting — both read from naabu_results
  zgrab2_service:      ["naabu"],
  nmap_service:        ["naabu"],
};

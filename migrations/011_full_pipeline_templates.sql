-- ============================================================
-- Migration 011 — Expand pipeline templates to include all registry tools
--
-- Standard: 20 groups, all 37 step_ids from STEP_REGISTRY.
--   New/optional tools (wafw00f, cewl, puredns_custom, naabu_full,
--   zgrab2_service, nmap_service, httpx_ports, cloud_enum, s3scanner)
--   are present but disabled=false so users just toggle them on.
--   wildcard_check and verify_dedup (BaseActions) are enabled by default.
--
-- SaaS / Cloud: same structure, cloud_enum + s3scanner enabled by default.
-- Corporate: same structure, wafw00f + naabu_full enabled by default.
-- Minimal: untouched — kept intentionally small.
-- ============================================================

-- ── Standard ──────────────────────────────────────────────────────────────────
UPDATE pipeline_templates
SET
  description = 'Full recon pipeline — 20 groups, all tools (optional tools disabled by default)',
  config = '{
  "groups": [
    {"id":"g01","name":"Passive Enumeration","position":1,"parallel":true,
     "steps":[
       {"step_id":"subfinder","position":1,"enabled":true},
       {"step_id":"amass","position":2,"enabled":true},
       {"step_id":"tlsx","position":3,"enabled":true},
       {"step_id":"assetfinder","position":4,"enabled":true},
       {"step_id":"crt_sh","position":5,"enabled":true},
       {"step_id":"gau","position":6,"enabled":true}
     ]},
    {"id":"g02","name":"Wildcard Check","position":2,"parallel":false,
     "steps":[
       {"step_id":"wildcard_check","position":1,"enabled":true}
     ]},
    {"id":"g03","name":"DNS Brute-force","position":3,"parallel":false,
     "steps":[
       {"step_id":"puredns_default","position":1,"enabled":true}
     ]},
    {"id":"g04","name":"Consolidate R1","position":4,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r1","position":1,"enabled":true}
     ]},
    {"id":"g05","name":"HTTP Probe R1","position":5,"parallel":false,
     "steps":[
       {"step_id":"httpx_r1","position":1,"enabled":true}
     ]},
    {"id":"g06","name":"WAF Detection","position":6,"parallel":false,
     "steps":[
       {"step_id":"wafw00f","position":1,"enabled":false}
     ]},
    {"id":"g07","name":"Permutation Generation","position":7,"parallel":false,
     "steps":[
       {"step_id":"alterx","position":1,"enabled":true},
       {"step_id":"cewl","position":2,"enabled":false}
     ]},
    {"id":"g08","name":"DNS Resolve Permutations","position":8,"parallel":true,
     "steps":[
       {"step_id":"puredns_permutation","position":1,"enabled":true},
       {"step_id":"puredns_custom","position":2,"enabled":false}
     ]},
    {"id":"g09","name":"Consolidate R2","position":9,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r2","position":1,"enabled":true}
     ]},
    {"id":"g10","name":"HTTP Probe R2","position":10,"parallel":false,
     "steps":[
       {"step_id":"httpx_r2","position":1,"enabled":true}
     ]},
    {"id":"g11","name":"JS Crawling","position":11,"parallel":true,
     "steps":[
       {"step_id":"katana","position":1,"enabled":true},
       {"step_id":"subdomainizer","position":2,"enabled":true}
     ]},
    {"id":"g12","name":"Consolidate R3","position":12,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r3","position":1,"enabled":true}
     ]},
    {"id":"g13","name":"HTTP Probe R3","position":13,"parallel":false,
     "steps":[
       {"step_id":"httpx_r3","position":1,"enabled":true}
     ]},
    {"id":"g14","name":"Port Scanning","position":14,"parallel":false,
     "steps":[
       {"step_id":"naabu","position":1,"enabled":true},
       {"step_id":"naabu_full","position":2,"enabled":false}
     ]},
    {"id":"g15","name":"Service Fingerprinting","position":15,"parallel":false,
     "steps":[
       {"step_id":"zgrab2_service","position":1,"enabled":false},
       {"step_id":"nmap_service","position":2,"enabled":false}
     ]},
    {"id":"g16","name":"Port HTTP Probe","position":16,"parallel":false,
     "steps":[
       {"step_id":"httpx_ports","position":1,"enabled":false}
     ]},
    {"id":"g17","name":"Cloud & Storage","position":17,"parallel":true,
     "steps":[
       {"step_id":"cloud_enum","position":1,"enabled":false},
       {"step_id":"s3scanner","position":2,"enabled":false}
     ]},
    {"id":"g18","name":"Takeover Detection","position":18,"parallel":false,
     "steps":[
       {"step_id":"nuclei_takeover","position":1,"enabled":true}
     ]},
    {"id":"g19","name":"Screenshots","position":19,"parallel":false,
     "steps":[
       {"step_id":"gowitness","position":1,"enabled":true}
     ]},
    {"id":"g20","name":"Post-processing","position":20,"parallel":false,
     "steps":[
       {"step_id":"verify_dedup","position":1,"enabled":true},
       {"step_id":"diff","position":2,"enabled":true}
     ]}
  ]
}'
WHERE name = 'standard';

-- ── SaaS / Cloud ──────────────────────────────────────────────────────────────
UPDATE pipeline_templates
SET
  description = 'Standard + cloud asset discovery enabled by default (cloud_enum, s3scanner)',
  config = '{
  "groups": [
    {"id":"g01","name":"Passive Enumeration","position":1,"parallel":true,
     "steps":[
       {"step_id":"subfinder","position":1,"enabled":true},
       {"step_id":"amass","position":2,"enabled":true},
       {"step_id":"tlsx","position":3,"enabled":true},
       {"step_id":"assetfinder","position":4,"enabled":true},
       {"step_id":"crt_sh","position":5,"enabled":true},
       {"step_id":"gau","position":6,"enabled":true}
     ]},
    {"id":"g02","name":"Wildcard Check","position":2,"parallel":false,
     "steps":[
       {"step_id":"wildcard_check","position":1,"enabled":true}
     ]},
    {"id":"g03","name":"DNS Brute-force","position":3,"parallel":false,
     "steps":[
       {"step_id":"puredns_default","position":1,"enabled":true}
     ]},
    {"id":"g04","name":"Consolidate R1","position":4,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r1","position":1,"enabled":true}
     ]},
    {"id":"g05","name":"HTTP Probe R1","position":5,"parallel":false,
     "steps":[
       {"step_id":"httpx_r1","position":1,"enabled":true}
     ]},
    {"id":"g06","name":"WAF Detection","position":6,"parallel":false,
     "steps":[
       {"step_id":"wafw00f","position":1,"enabled":false}
     ]},
    {"id":"g07","name":"Permutation Generation","position":7,"parallel":false,
     "steps":[
       {"step_id":"alterx","position":1,"enabled":true},
       {"step_id":"cewl","position":2,"enabled":false}
     ]},
    {"id":"g08","name":"DNS Resolve Permutations","position":8,"parallel":true,
     "steps":[
       {"step_id":"puredns_permutation","position":1,"enabled":true},
       {"step_id":"puredns_custom","position":2,"enabled":false}
     ]},
    {"id":"g09","name":"Consolidate R2","position":9,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r2","position":1,"enabled":true}
     ]},
    {"id":"g10","name":"HTTP Probe R2","position":10,"parallel":false,
     "steps":[
       {"step_id":"httpx_r2","position":1,"enabled":true}
     ]},
    {"id":"g11","name":"JS Crawling","position":11,"parallel":true,
     "steps":[
       {"step_id":"katana","position":1,"enabled":true},
       {"step_id":"subdomainizer","position":2,"enabled":true}
     ]},
    {"id":"g12","name":"Consolidate R3","position":12,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r3","position":1,"enabled":true}
     ]},
    {"id":"g13","name":"HTTP Probe R3","position":13,"parallel":false,
     "steps":[
       {"step_id":"httpx_r3","position":1,"enabled":true}
     ]},
    {"id":"g14","name":"Port Scanning","position":14,"parallel":false,
     "steps":[
       {"step_id":"naabu","position":1,"enabled":true},
       {"step_id":"naabu_full","position":2,"enabled":false}
     ]},
    {"id":"g15","name":"Service Fingerprinting","position":15,"parallel":false,
     "steps":[
       {"step_id":"zgrab2_service","position":1,"enabled":false},
       {"step_id":"nmap_service","position":2,"enabled":false}
     ]},
    {"id":"g16","name":"Port HTTP Probe","position":16,"parallel":false,
     "steps":[
       {"step_id":"httpx_ports","position":1,"enabled":false}
     ]},
    {"id":"g17","name":"Cloud & Storage","position":17,"parallel":true,
     "steps":[
       {"step_id":"cloud_enum","position":1,"enabled":true},
       {"step_id":"s3scanner","position":2,"enabled":true}
     ]},
    {"id":"g18","name":"Takeover Detection","position":18,"parallel":false,
     "steps":[
       {"step_id":"nuclei_takeover","position":1,"enabled":true}
     ]},
    {"id":"g19","name":"Screenshots","position":19,"parallel":false,
     "steps":[
       {"step_id":"gowitness","position":1,"enabled":true}
     ]},
    {"id":"g20","name":"Post-processing","position":20,"parallel":false,
     "steps":[
       {"step_id":"verify_dedup","position":1,"enabled":true},
       {"step_id":"diff","position":2,"enabled":true}
     ]}
  ]
}'
WHERE name = 'saas';

-- ── Corporate ─────────────────────────────────────────────────────────────────
UPDATE pipeline_templates
SET
  description = 'Standard + WAF detection + extended port range + service fingerprinting enabled',
  config = '{
  "groups": [
    {"id":"g01","name":"Passive Enumeration","position":1,"parallel":true,
     "steps":[
       {"step_id":"subfinder","position":1,"enabled":true},
       {"step_id":"amass","position":2,"enabled":true},
       {"step_id":"tlsx","position":3,"enabled":true},
       {"step_id":"assetfinder","position":4,"enabled":true},
       {"step_id":"crt_sh","position":5,"enabled":true},
       {"step_id":"gau","position":6,"enabled":true}
     ]},
    {"id":"g02","name":"Wildcard Check","position":2,"parallel":false,
     "steps":[
       {"step_id":"wildcard_check","position":1,"enabled":true}
     ]},
    {"id":"g03","name":"DNS Brute-force","position":3,"parallel":false,
     "steps":[
       {"step_id":"puredns_default","position":1,"enabled":true}
     ]},
    {"id":"g04","name":"Consolidate R1","position":4,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r1","position":1,"enabled":true}
     ]},
    {"id":"g05","name":"HTTP Probe R1","position":5,"parallel":false,
     "steps":[
       {"step_id":"httpx_r1","position":1,"enabled":true}
     ]},
    {"id":"g06","name":"WAF Detection","position":6,"parallel":false,
     "steps":[
       {"step_id":"wafw00f","position":1,"enabled":true}
     ]},
    {"id":"g07","name":"Permutation Generation","position":7,"parallel":false,
     "steps":[
       {"step_id":"alterx","position":1,"enabled":true},
       {"step_id":"cewl","position":2,"enabled":false}
     ]},
    {"id":"g08","name":"DNS Resolve Permutations","position":8,"parallel":true,
     "steps":[
       {"step_id":"puredns_permutation","position":1,"enabled":true},
       {"step_id":"puredns_custom","position":2,"enabled":false}
     ]},
    {"id":"g09","name":"Consolidate R2","position":9,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r2","position":1,"enabled":true}
     ]},
    {"id":"g10","name":"HTTP Probe R2","position":10,"parallel":false,
     "steps":[
       {"step_id":"httpx_r2","position":1,"enabled":true}
     ]},
    {"id":"g11","name":"JS Crawling","position":11,"parallel":true,
     "steps":[
       {"step_id":"katana","position":1,"enabled":true},
       {"step_id":"subdomainizer","position":2,"enabled":true}
     ]},
    {"id":"g12","name":"Consolidate R3","position":12,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r3","position":1,"enabled":true}
     ]},
    {"id":"g13","name":"HTTP Probe R3","position":13,"parallel":false,
     "steps":[
       {"step_id":"httpx_r3","position":1,"enabled":true}
     ]},
    {"id":"g14","name":"Port Scanning","position":14,"parallel":false,
     "steps":[
       {"step_id":"naabu","position":1,"enabled":true},
       {"step_id":"naabu_full","position":2,"enabled":true}
     ]},
    {"id":"g15","name":"Service Fingerprinting","position":15,"parallel":false,
     "steps":[
       {"step_id":"zgrab2_service","position":1,"enabled":true},
       {"step_id":"nmap_service","position":2,"enabled":false}
     ]},
    {"id":"g16","name":"Port HTTP Probe","position":16,"parallel":false,
     "steps":[
       {"step_id":"httpx_ports","position":1,"enabled":true}
     ]},
    {"id":"g17","name":"Cloud & Storage","position":17,"parallel":true,
     "steps":[
       {"step_id":"cloud_enum","position":1,"enabled":false},
       {"step_id":"s3scanner","position":2,"enabled":false}
     ]},
    {"id":"g18","name":"Takeover Detection","position":18,"parallel":false,
     "steps":[
       {"step_id":"nuclei_takeover","position":1,"enabled":true}
     ]},
    {"id":"g19","name":"Screenshots","position":19,"parallel":false,
     "steps":[
       {"step_id":"gowitness","position":1,"enabled":true}
     ]},
    {"id":"g20","name":"Post-processing","position":20,"parallel":false,
     "steps":[
       {"step_id":"verify_dedup","position":1,"enabled":true},
       {"step_id":"diff","position":2,"enabled":true}
     ]}
  ]
}'
WHERE name = 'corporate';

-- ── Minimal — add wildcard_check + verify_dedup/diff ─────────────────────────
UPDATE pipeline_templates
SET
  description = 'Passive enumeration + consolidate + HTTP probe only (fastest)',
  config = '{
  "groups": [
    {"id":"g01","name":"Passive Enumeration","position":1,"parallel":true,
     "steps":[
       {"step_id":"subfinder","position":1,"enabled":true},
       {"step_id":"tlsx","position":2,"enabled":true},
       {"step_id":"crt_sh","position":3,"enabled":true}
     ]},
    {"id":"g02","name":"Wildcard Check","position":2,"parallel":false,
     "steps":[
       {"step_id":"wildcard_check","position":1,"enabled":true}
     ]},
    {"id":"g03","name":"Consolidate R1","position":3,"parallel":false,
     "steps":[
       {"step_id":"consolidate_r1","position":1,"enabled":true}
     ]},
    {"id":"g04","name":"HTTP Probe R1","position":4,"parallel":false,
     "steps":[
       {"step_id":"httpx_r1","position":1,"enabled":true}
     ]},
    {"id":"g05","name":"Post-processing","position":5,"parallel":false,
     "steps":[
       {"step_id":"verify_dedup","position":1,"enabled":true},
       {"step_id":"diff","position":2,"enabled":true}
     ]}
  ]
}'
WHERE name = 'minimal';

/* =========================================================
   TOPOLOGY LOGIC ENGINE (STABLE + LLDP OPTIONAL ROUTE)
   ========================================================= */

/* ===================== CONFIG ===================== */
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTzmuXWKiUU2trRaG4ULysiwYdX2c3KYO6gVtE3pfkJzD0Q7lVbHircpGy6MYcLtcWd9rZSwdqQUrx5/pub?gid=0&single=true&output=csv";

/* ===================== LOAD CSV ===================== */
async function loadCSV() {
  const res = await fetch(CSV_URL);
  const text = await res.text();
  return Papa.parse(text, {
    header: true,
    skipEmptyLines: true
  }).data;
}

/* ===================== BUILD GRAPH ===================== */
function buildGraph(rows) {
  const graph = {};

  rows.forEach(r => {
    const ne = (r["NE Name"] || "").trim();
    if (!ne) return;

    if (!graph[ne]) graph[ne] = [];

    const lldp = (r["LLDP List"] || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);

    lldp.forEach(peer => {
      if (!graph[ne].includes(peer)) graph[ne].push(peer);
      if (!graph[peer]) graph[peer] = [];
      if (!graph[peer].includes(ne)) graph[peer].push(ne);
    });
  });

  return graph;
}

/* ===================== CORE DETECTION ===================== */
function isCore(ne) {
  return /-CN\d+-/i.test(ne);
}

/* ===================== ORIGINAL PATH TO CORE (DO NOT TOUCH) ===================== */
function pathToCore(graph, start) {
  const queue = [[start]];
  const visited = new Set();
  const paths = [];
  let shortestDepth = Infinity;

  while (queue.length) {
    const path = queue.shift();
    const last = path[path.length - 1];

    if (path.length > shortestDepth) continue;

    if (isCore(last)) {
      shortestDepth = path.length;
      paths.push(path);
      continue;
    }

    visited.add(last);

    for (const n of graph[last] || []) {
      if (path.includes(n)) continue;
      queue.push([...path, n]);
    }
  }

  if (paths.length === 0) {
    return { noCore: true, nodes: [start], edges: [] };
  }

  return extractSubgraph(paths);
}

/* ===================== NEW: PATH WITH FORCED NEXT HOP ===================== */
function pathToCoreVia(graph, start, nextHop) {
  if (!graph[start] || !graph[start].includes(nextHop)) {
    return { noCore: true, nodes: [start], edges: [] };
  }

  // paksa path mulai dari start → nextHop
  const sub = pathToCore(graph, nextHop);

  if (sub.noCore) {
    return { noCore: true, nodes: [start, nextHop], edges: [[start, nextHop]] };
  }

  // gabungkan start → nextHop ke path utama
  sub.nodes.push(start);
  sub.edges.push([start, nextHop]);

  return sub;
}

/* ===================== EXTRACT SUBGRAPH ===================== */
function extractSubgraph(paths) {
  const nodeSet = new Set();
  const edgeSet = new Set();

  paths.forEach(p => {
    p.forEach(n => nodeSet.add(n));
    for (let i = 0; i < p.length - 1; i++) {
      edgeSet.add(`${p[i]}||${p[i + 1]}`);
    }
  });

  return {
    nodes: [...nodeSet],
    edges: [...edgeSet].map(e => e.split("||"))
  };
}

/* ===================== LEVEL ASSIGNMENT ===================== */
function assignLevels(nodes, edges) {
  const levels = {};
  const core = nodes.find(isCore);
  if (!core) return levels;

  const queue = [{ node: core, level: 0 }];
  levels[core] = 0;

  while (queue.length) {
    const { node, level } = queue.shift();
    edges.forEach(([a, b]) => {
      const next =
        a === node && levels[b] === undefined ? b :
        b === node && levels[a] === undefined ? a : null;

      if (next) {
        levels[next] = level + 1;
        queue.push({ node: next, level: level + 1 });
      }
    });
  }
  return levels;
}

/* ===================== BUILD FINAL JSON ===================== */
function buildTopologyJSON(result) {
  const { nodes, edges, noCore } = result;
  let levels = assignLevels(nodes, edges);

  if (Object.keys(levels).length === 0) {
    nodes.forEach((n, i) => levels[n] = i);
  }

  return {
    noCore: !!noCore,
    nodes: nodes.map(n => ({
      id: n,
      type: isCore(n) ? "CORE" : "ROUTER",
      level: levels[n]
    })),
    edges: edges.map(e => ({ source: e[0], target: e[1] }))
  };
}

/* ===================== PUBLIC API ===================== */
async function analyzePrimary(target) {
  const rows = await loadCSV();
  const graph = buildGraph(rows);
  const sub = pathToCore(graph, target);
  return { topo: buildTopologyJSON(sub), lldp: graph[target] || [] };
}

async function analyzeVia(target, via) {
  const rows = await loadCSV();
  const graph = buildGraph(rows);
  const sub = pathToCoreVia(graph, target, via);
  return buildTopologyJSON(sub);
}

/* =========================================================
   🔍 LOOKUP ONLY — DOES NOT AFFECT TOPOLOGY
   ========================================================= */
async function lookupNE(query) {
  const rows = await loadCSV();
  query = query.trim().toLowerCase();
  const result = new Set();

  rows.forEach(r => {
    const ne = (r["NE Name"] || "").trim();
    if (!ne) return;

    const siteId = (r["Site ID"] || "").trim();
    const deps = (r["Site DEPS"] || "")
      .split(",")
      .map(x => x.trim());

    if (ne.toLowerCase().includes(query)) result.add(ne);
    if (siteId.toLowerCase() === query) result.add(ne);
    if (deps.some(d => d.toLowerCase() === query)) result.add(ne);
  });

  return [...result];
}



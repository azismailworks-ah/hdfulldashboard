/* =========================================================
   MULTI-NE CONVERGENCE ENGINE
   STRICT NON-CORE PRIORITY (FINAL STABLE + CORE TAIL FIX)
   ========================================================= */

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTzmuXWKiUU2trRaG4ULysiwYdX2c3KYO6gVtE3pfkJzD0Q7lVbHircpGy6MYcLtcWd9rZSwdqQUrx5/pub?gid=0&single=true&output=csv";

/* ===================== LOAD CSV ===================== */
async function loadCSV(){
  const res = await fetch(CSV_URL);
  const txt = await res.text();
  return Papa.parse(txt,{ header:true, skipEmptyLines:true }).data;
}

/* ===================== RESOLVE INPUT ===================== */
function resolveInput(rows,input){
  input=input.trim();

  const byNE = rows.find(r => (r["NE Name"]||"").trim()===input);
  if(byNE) return [byNE["NE Name"].trim()];

  const bySite = rows.find(r => (r["Site ID"]||"").trim()===input);
  if(bySite) return [bySite["NE Name"].trim()];

  const byDeps = rows.find(r =>
    (r["Site DEPS"]||"").split(",").map(x=>x.trim()).includes(input)
  );
  if(byDeps) return [byDeps["NE Name"].trim()];

  return rows
    .map(r=>r["NE Name"])
    .filter(n=>n && n.includes(input));
}

/* ===================== GRAPH ===================== */
function buildGraph(rows){
  const g={};
  rows.forEach(r=>{
    const ne=(r["NE Name"]||"").trim();
    if(!ne) return;
    if(!g[ne]) g[ne]=[];
    (r["LLDP List"]||"").split(",").map(x=>x.trim()).forEach(p=>{
      if(!p) return;
      if(!g[ne].includes(p)) g[ne].push(p);
      if(!g[p]) g[p]=[];
      if(!g[p].includes(ne)) g[p].push(ne);
    });
  });
  return g;
}

function isCore(n){
  return /-CN\d+-/i.test(n);
}

/* ===================== ALL SHORTEST PATHS ===================== */
function shortestPaths(graph,start){
  const paths=[];
  const queue=[[start]];
  const visited={ [start]:0 };

  while(queue.length){
    const path=queue.shift();
    const last=path[path.length-1];

    paths.push(path);

    for(const n of graph[last]||[]){
      if(visited[n]===undefined){
        visited[n]=path.length;
        queue.push([...path,n]);
      }
    }
  }
  return paths;
}

/* ===================== PATH FROM NODE TO CORE (NEW – REQUIRED) ===================== */
function pathFromNodeToCore(graph,start){
  const queue=[[start]];
  const visited=new Set([start]);

  while(queue.length){
    const path=queue.shift();
    const last=path[path.length-1];

    if(isCore(last)) return path;

    for(const n of graph[last]||[]){
      if(!visited.has(n)){
        visited.add(n);
        queue.push([...path,n]);
      }
    }
  }
  return null;
}

/* ===================== CONVERGENCE ANALYSIS ===================== */
async function analyzeConvergence(inputs){
  const rows=await loadCSV();
  const graph=buildGraph(rows);

  /* Resolve input */
  let resolved=[];
  inputs.forEach(i=>{
    resolveInput(rows,i).forEach(n=>{
      if(graph[n]) resolved.push(n);
    });
  });
  resolved=[...new Set(resolved)];

  if(resolved.length<2){
    return { resolved, convergence:null, graph:{nodes:[],edges:[]} };
  }

  /* All paths */
  const allPaths={};
  resolved.forEach(ne=>{
    allPaths[ne]=shortestPaths(graph,ne);
  });

  /* Candidate nodes */
  const counter={};
  Object.values(allPaths).forEach(paths=>{
    paths.forEach(p=>{
      p.forEach((n,i)=>{
        if(!counter[n]) counter[n]=[];
        counter[n].push(i);
      });
    });
  });

  const required=resolved.length;
  const candidates = Object.entries(counter)
    .filter(([_,arr])=>arr.length>=required);

  /* Select BEST – NON CORE PRIORITY */
  let best=null;
  let bestScore=Infinity;

  candidates.forEach(([n,arr])=>{
    const score=arr.reduce((a,b)=>a+b,0);
    if(!isCore(n) && score<bestScore){
      best=n;
      bestScore=score;
    }
  });

  /* CORE fallback */
  if(!best){
    candidates.forEach(([n,arr])=>{
      const score=arr.reduce((a,b)=>a+b,0);
      if(isCore(n) && score<bestScore){
        best=n;
        bestScore=score;
      }
    });
  }

  const convergence=best;

  /* ===================== BUILD GRAPH (FIXED) ===================== */
  const nodes=[];
  const edges=[];
  const seen=new Set();

  resolved.forEach(src=>{
    const validPath = allPaths[src].find(p=>p.includes(convergence));
    if(!validPath) return;

    const idx = validPath.indexOf(convergence);

    // 1️⃣ Source → Convergence (NON-CORE)
    for(let i=0;i<=idx;i++){
      const n=validPath[i];
      if(!seen.has(n)){
        seen.add(n);
        nodes.push({
          id:n,
          source:n===src,
          convergence:n===convergence
        });
      }
      if(i<idx){
        edges.push({ source:validPath[i], target:validPath[i+1] });
      }
    }

    // 2️⃣ Convergence → CORE (FINAL DESTINATION)
    const tail = pathFromNodeToCore(graph, convergence);
    if(tail){
      for(let i=1;i<tail.length;i++){
        const n=tail[i];
        if(!seen.has(n)){
          seen.add(n);
          nodes.push({
            id:n,
            source:false,
            convergence:false
          });
        }
        edges.push({ source:tail[i-1], target:tail[i] });
      }
    }
  });

  return {
    resolved,
    convergence,
    graph:{ nodes, edges }
  };
}

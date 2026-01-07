import { getSupabaseClient } from "./supabaseClient.js";
import { clearSession } from "./sessionStore.js";

const LABEL_LIMIT = 24;
const DEPTH_MIN = 1;
const DEPTH_MAX = 2;

function shortLabel(text = "") {
  const trimmed = text.trim();
  if (trimmed.length <= LABEL_LIMIT) return trimmed;
  return `${trimmed.slice(0, LABEL_LIMIT - 1)}…`;
}

function parseDepth(value) {
  if (!value) return DEPTH_MIN;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEPTH_MIN;
  return Math.min(Math.max(parsed, DEPTH_MIN), DEPTH_MAX);
}

function buildSubgraph(noteId, depth, relations) {
  const allowed = new Set([noteId]);
  let frontier = new Set([noteId]);

  for (let level = 0; level < depth; level += 1) {
    const nextFrontier = new Set();
    relations.forEach((rel) => {
      const from = rel.from;
      const to = rel.to;
      if (frontier.has(from)) {
        nextFrontier.add(to);
      }
      if (frontier.has(to)) {
        nextFrontier.add(from);
      }
    });
    nextFrontier.forEach((id) => allowed.add(id));
    frontier = nextFrontier;
  }

  return allowed;
}

function mapElements(notes, relations, allowedIds) {
  const noteSet = new Set(allowedIds ?? notes.map((note) => note.id));
  const nodes = notes
    .filter((note) => noteSet.has(note.id))
    .map((note) => ({
      data: {
        id: note.id,
        label: shortLabel(note.subject),
        subject: note.subject ?? "",
        moment: note.moment ?? "",
        created_at: note.created_at ?? "",
      },
    }));

  const edges = relations
    .filter((rel) => noteSet.has(rel.from) && noteSet.has(rel.to))
    .map((rel) => ({
      data: {
        id: `${rel.from}-${rel.to}-${rel.type}`,
        source: rel.from,
        target: rel.to,
        type: rel.type ?? "",
      },
    }));

  return { nodes, edges };
}

export function createGraphUI(bus) {
  const overlay = document.getElementById("graph-overlay");
  const canvas = document.getElementById("graph-canvas");
  const emptyState = document.getElementById("graph-empty");
  const detailEmpty = document.getElementById("graph-detail-empty");
  const detailList = document.getElementById("graph-detail-list");
  const detailId = document.getElementById("graph-detail-id");
  const detailSubject = document.getElementById("graph-detail-subject");
  const detailMoment = document.getElementById("graph-detail-moment");
  const detailCreated = document.getElementById("graph-detail-created");

  let cy = null;
  let isOpen = false;
  let lastOptions = { focusNoteId: null, depth: DEPTH_MIN };

  function showDetails(data) {
    detailId.textContent = data.id ?? "";
    detailSubject.textContent = data.subject ?? "";
    detailMoment.textContent = data.moment ?? "";
    detailCreated.textContent = data.created_at ?? "";
    detailEmpty.hidden = true;
    detailList.hidden = false;
  }

  function clearDetails() {
    detailId.textContent = "";
    detailSubject.textContent = "";
    detailMoment.textContent = "";
    detailCreated.textContent = "";
    detailList.hidden = true;
    detailEmpty.hidden = false;
  }

  function ensureCytoscape() {
    if (cy) return cy;
    if (!window.cytoscape) {
      bus.emit("output:append", "Cytoscape.js não carregado.");
      return null;
    }
    cy = window.cytoscape({
      container: canvas,
      elements: [],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#000",
            "border-color": "#0f0",
            "border-width": 1,
            color: "#0f0",
            label: "data(label)",
            "font-size": 10,
            "text-wrap": "wrap",
            "text-max-width": 80,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#0f0",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#0f0",
            "curve-style": "bezier",
          },
        },
        {
          selector: "node:selected",
          style: {
            "background-color": "#0f0",
            color: "#000",
          },
        },
      ],
      layout: { name: "cose", animate: false },
    });

    cy.on("tap", "node", (event) => {
      showDetails(event.target.data());
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        clearDetails();
      }
    });

    return cy;
  }

  async function getAuthenticatedUser(client) {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) {
      clearSession();
      bus.emit("output:append", "Você precisa estar logado para usar este comando.");
      return null;
    }
    return data.user;
  }

  async function loadGraph(options = {}) {
    if (!isOpen) return;
    const focusNoteId = options.focusNoteId ?? lastOptions.focusNoteId;
    const depth = parseDepth(options.depth ?? lastOptions.depth);
    lastOptions = { focusNoteId, depth };

    const clientResponse = getSupabaseClient();
    if (clientResponse.error || !clientResponse.client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(clientResponse.client);
    if (!user) return;

    const [notesResponse, relsResponse] = await Promise.all([
      clientResponse.client
        .from("notes")
        .select("id,subject,moment,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      clientResponse.client
        .from("relations")
        .select("from,to,type")
        .eq("user_id", user.id),
    ]);

    if (notesResponse.error) {
      bus.emit("output:append", `Erro ao carregar notas: ${notesResponse.error.message}`);
      return;
    }
    if (relsResponse.error) {
      bus.emit("output:append", `Erro ao carregar relações: ${relsResponse.error.message}`);
      return;
    }

    const notes = notesResponse.data ?? [];
    const relations = relsResponse.data ?? [];

    if (notes.length === 0) {
      emptyState.hidden = false;
      clearDetails();
      if (cy) {
        cy.elements().remove();
      }
      return;
    }

    emptyState.hidden = true;
    if (focusNoteId && !notes.some((note) => note.id === focusNoteId)) {
      bus.emit("output:append", "Nota não encontrada no grafo.");
    }
    const allowed = focusNoteId ? buildSubgraph(focusNoteId, depth, relations) : null;

    const elements = mapElements(notes, relations, allowed);
    const instance = ensureCytoscape();
    if (!instance) return;

    instance.elements().remove();
    instance.add([...elements.nodes, ...elements.edges]);
    instance.layout({ name: "cose", animate: false }).run();

    clearDetails();

    if (focusNoteId) {
      const target = instance.getElementById(focusNoteId);
      if (target && target.length > 0) {
        target.select();
        instance.center(target);
      }
    } else {
      instance.fit();
    }
  }

  function openGraph(options = {}) {
    overlay.hidden = false;
    isOpen = true;
    loadGraph(options);
  }

  function closeGraph() {
    overlay.hidden = true;
    isOpen = false;
  }

  function toggleGraph() {
    if (isOpen) {
      closeGraph();
      return;
    }
    lastOptions = { focusNoteId: null, depth: DEPTH_MIN };
    openGraph(lastOptions);
  }

  bus.on("graph:toggle", () => toggleGraph());
  bus.on("graph:open", (options = {}) => {
    openGraph(options);
  });
  bus.on("graph:refresh", () => loadGraph());

  return { toggleGraph, openGraph, closeGraph, loadGraph };
}

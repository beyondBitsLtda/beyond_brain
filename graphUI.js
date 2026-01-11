import { getSupabaseClient } from "./supabaseClient.js";
import { clearSession } from "./sessionStore.js";
import { getCurrentTheme } from "./themeManager.js";
import { createGraphNoteWindow } from "./graphNoteWindow.js";
import { createContextMenu } from "./ui/contextMenu.js";
import { clearDeleteBySubjectState } from "./state/deleteBySubjectState.js";

const LABEL_LIMIT = 24;
const DEPTH_MIN = 1;
const DEPTH_MAX = 2;
const RELATION_TYPES = ["related", "ref", "expands", "contradicts"];

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
      const from = rel.from_note_id;
      const to = rel.to_note_id;
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
    .filter((rel) => noteSet.has(rel.from_note_id) && noteSet.has(rel.to_note_id))
    .map((rel) => ({
      data: {
        id: `${rel.from_note_id}-${rel.to_note_id}-${rel.type}`,
        source: rel.from_note_id,
        target: rel.to_note_id,
        type: rel.type ?? "",
        from_note_id: rel.from_note_id,
        to_note_id: rel.to_note_id,
      },
    }));

  return { nodes, edges };
}

export function createGraphUI(bus, focusManager) {
  const overlay = document.getElementById("graph-overlay");
  const canvas = document.getElementById("graph-canvas");
  const emptyState = document.getElementById("graph-empty");
  const detailEmpty = document.getElementById("graph-detail-empty");
  const detailList = document.getElementById("graph-detail-list");
  const detailId = document.getElementById("graph-detail-id");
  const detailSubject = document.getElementById("graph-detail-subject");
  const detailMoment = document.getElementById("graph-detail-moment");
  const detailCreated = document.getElementById("graph-detail-created");
  const noteWindow = createGraphNoteWindow(overlay);
  const contextMenu = createContextMenu();

  let cy = null;
  let isOpen = false;
  let lastOptions = { focusNoteId: null, depth: DEPTH_MIN };
  let edgePulseFrame = null;
  let edgePulseStart = null;
  let noteBodies = new Map();
  let connectMode = {
    active: false,
    fromNoteId: null,
    fromSubject: "",
  };

  function getThemeTokens() {
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: styles.getPropertyValue("--bg").trim() || "#000",
      fg: styles.getPropertyValue("--fg").trim() || "#0f0",
      border: styles.getPropertyValue("--border").trim() || "#0f0",
      accent: styles.getPropertyValue("--accent").trim() || "#0f0",
    };
  }

  function isSteveTheme() {
    return getCurrentTheme() === "steve";
  }

  function getEdgeStyle(border) {
    if (isSteveTheme()) {
      return {
        width: 3,
        "line-color": "#ff2b3a",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#ff2b3a",
        "curve-style": "bezier",
        opacity: 0.75,
        "shadow-blur": 12,
        "shadow-color": "rgba(255, 43, 58, 0.7)",
        "shadow-opacity": 0.8,
      };
    }

    return {
      width: 1,
      "line-color": border,
      "target-arrow-shape": "triangle",
      "target-arrow-color": border,
      "curve-style": "bezier",
    };
  }

  function stopSteveEdgePulse() {
    if (edgePulseFrame) {
      cancelAnimationFrame(edgePulseFrame);
      edgePulseFrame = null;
    }
    edgePulseStart = null;
  }

  function shouldPulseSteveEdges() {
    return isOpen && cy && isSteveTheme();
  }

  function startSteveEdgePulse() {
    stopSteveEdgePulse();
    if (!cy) return;

    const edges = cy.edges();
    const minWidth = 2.5;
    const maxWidth = 3.5;
    const minOpacity = 0.6;
    const maxOpacity = 0.85;
    const minShadow = 8;
    const maxShadow = 14;
    const speed = 0.6;

    const tick = (timestamp) => {
      if (!shouldPulseSteveEdges()) {
        stopSteveEdgePulse();
        return;
      }
      if (!edgePulseStart) edgePulseStart = timestamp;
      const elapsed = (timestamp - edgePulseStart) / 1000;
      const wave = (Math.sin(elapsed * Math.PI * 2 * speed) + 1) / 2;
      const glowWave = (Math.sin(elapsed * Math.PI * 2 * speed + Math.PI / 2) + 1) / 2;
      const width = minWidth + (maxWidth - minWidth) * wave;
      const opacity = minOpacity + (maxOpacity - minOpacity) * glowWave;
      const shadowBlur = minShadow + (maxShadow - minShadow) * glowWave;

      edges.style({ width, opacity, "shadow-blur": shadowBlur });
      edgePulseFrame = requestAnimationFrame(tick);
    };

    edgePulseFrame = requestAnimationFrame(tick);
  }

  function updateSteveEdgePulse() {
    if (shouldPulseSteveEdges()) {
      startSteveEdgePulse();
      return;
    }
    stopSteveEdgePulse();
  }

  function applyGraphTheme() {
    if (!cy) return;
    const { bg, fg, border, accent } = getThemeTokens();
    cy.style([
      {
        selector: "node",
        style: {
          "background-color": bg,
          "border-color": border,
          "border-width": 1,
          color: fg,
          label: "data(label)",
          "font-size": 10,
          "text-wrap": "wrap",
          "text-max-width": 80,
        },
      },
      {
        selector: "edge",
        style: getEdgeStyle(border),
      },
      {
        selector: "node:selected",
        style: {
          "background-color": accent,
          color: bg,
        },
      },
    ]);
    updateSteveEdgePulse();
  }

  overlay.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".graph-panel")) {
      setTimeout(() => bus.emit("input:focus"), 0);
    }
  });

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
    const { bg, fg, border, accent } = getThemeTokens();
    cy = window.cytoscape({
      container: canvas,
      elements: [],
      style: [
        {
          selector: "node",
          style: {
            "background-color": bg,
            "border-color": border,
            "border-width": 1,
            color: fg,
            label: "data(label)",
            "font-size": 10,
            "text-wrap": "wrap",
            "text-max-width": 80,
          },
        },
        {
          selector: "edge",
          style: getEdgeStyle(border),
        },
        {
          selector: "node:selected",
          style: {
            "background-color": accent,
            color: bg,
          },
        },
      ],
      layout: { name: "cose", animate: false },
    });

    cy.on("tap", "node", (event) => {
      const data = event.target.data();
      if (connectMode.active) {
        handleConnectTarget(data);
        return;
      }
      showDetails(data);
      noteWindow.open(noteBodies.get(data.id) ?? "");
    });

    cy.on("cxttap", "node", (event) => {
      const data = event.target.data();
      const { clientX, clientY } = event.originalEvent ?? {};
      contextMenu.open(clientX ?? 0, clientY ?? 0, [
        {
          label: "Abrir conteúdo",
          action: () => {
            showDetails(data);
            noteWindow.open(noteBodies.get(data.id) ?? "");
          },
        },
        {
          label: "Criar relação...",
          action: () => {
            startConnectMode({ fromNoteId: data.id, fromSubject: data.subject ?? "" });
          },
        },
        {
          label: "Deletar nota",
          danger: true,
          action: () => {
            confirmDeleteNote(data);
          },
        },
      ]);
    });

    cy.on("cxttap", "edge", (event) => {
      const data = event.target.data();
      const { clientX, clientY } = event.originalEvent ?? {};
      contextMenu.open(clientX ?? 0, clientY ?? 0, [
        {
          label: "Deletar relação",
          danger: true,
          action: () => {
            confirmDeleteRelation(data);
          },
        },
      ]);
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        clearDetails();
      }
    });

    updateSteveEdgePulse();
    return cy;
  }

  bus.on("theme:change", () => {
    applyGraphTheme();
  });

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
    const fallbackFocus = focusManager?.getFocusNoteId?.() ?? null;
    let focusNoteId = lastOptions.focusNoteId;
    if (Object.prototype.hasOwnProperty.call(options, "focusNoteId")) {
      focusNoteId = options.focusNoteId;
    } else if (fallbackFocus) {
      focusNoteId = fallbackFocus;
    }
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
        .select("id,subject,moment,created_at,body")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      clientResponse.client
        .from("note_relations")
        .select("from_note_id,to_note_id,type")
        .eq("user_id", user.id),
    ]);

    if (notesResponse.error) {
      bus.emit("output:append", `Erro ao carregar notas: ${notesResponse.error.message}`);
      return;
    }
    if (relsResponse.error) {
      bus.emit("output:append", `Erro ao carregar relações na note_relations: ${relsResponse.error.message}`);
      return;
    }

    const notes = notesResponse.data ?? [];
    const relations = relsResponse.data ?? [];
    noteBodies = new Map(notes.map((note) => [note.id, note.body ?? ""]));

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
    bus.emit("input:focus");
    loadGraph(options);
    updateSteveEdgePulse();
  }

  function closeGraph() {
    overlay.hidden = true;
    isOpen = false;
    noteWindow.close();
    stopSteveEdgePulse();
    cancelConnectMode();
  }

  function toggleGraph() {
    if (isOpen) {
      closeGraph();
      return;
    }
    lastOptions = { focusNoteId: focusManager?.getFocusNoteId?.() ?? null, depth: DEPTH_MIN };
    openGraph(lastOptions);
  }

  bus.on("graph:toggle", () => toggleGraph());
  bus.on("graph:open", (options = {}) => {
    openGraph(options);
  });
  bus.on("graph:refresh", () => loadGraph());
  bus.on("focus:changed", () => {
    if (!isOpen) return;
    loadGraph({ focusNoteId: focusManager?.getFocusNoteId?.() ?? null });
  });

  bus.on("connect:start", ({ fromNoteId, fromSubject } = {}) => {
    if (!fromNoteId) return;
    if (!isOpen) {
      openGraph(lastOptions);
    }
    startConnectMode({ fromNoteId, fromSubject });
  });

  bus.on("connect:cancel", () => {
    cancelConnectMode();
  });

  bus.on("input:escape", () => {
    if (connectMode.active) {
      cancelConnectMode();
    }
  });

  function startConnectMode({ fromNoteId, fromSubject }) {
    connectMode = {
      active: true,
      fromNoteId,
      fromSubject: fromSubject ?? "",
    };
    bus.emit(
      "output:append",
      "Selecione o nó de destino (clique) ou ESC para cancelar."
    );
  }

  function cancelConnectMode() {
    if (!connectMode.active) return;
    connectMode = { active: false, fromNoteId: null, fromSubject: "" };
    bus.emit("output:append", "Modo de conexão cancelado.");
  }

  function handleConnectTarget(targetData) {
    if (!connectMode.active) return;
    if (!targetData?.id) return;
    if (connectMode.fromNoteId === targetData.id) {
      bus.emit("output:append", "Selecione um nó diferente para criar a relação.");
      return;
    }
    promptRelationType(connectMode.fromNoteId, targetData.id);
  }

  function promptRelationType(fromId, toId) {
    const choices = RELATION_TYPES.join(", ");
    bus.emit(
      "output:append",
      `Tipo da relação (${choices}). Enter para "related".`
    );
    bus.emit("input:placeholder", "related");
    bus.emit("input:focus");
    bus.emit("router:capture:start", {
      echo: "normal",
      handler: async (value) => {
        bus.emit("router:capture:stop");
        bus.emit("input:placeholder", "");
        const normalized = value.trim().toLowerCase();
        if (normalized === "cancel") {
          cancelConnectMode();
          return;
        }
        const type = normalized === "" ? "related" : normalized;
        if (!RELATION_TYPES.includes(type)) {
          bus.emit("output:append", `Tipo inválido. Use: ${choices}.`);
          return;
        }
        await createRelation({ fromId, toId, type });
        connectMode = { active: false, fromNoteId: null, fromSubject: "" };
      },
      onCancel: () => {
        bus.emit("router:capture:stop");
        bus.emit("input:placeholder", "");
        cancelConnectMode();
      },
    });
  }

  async function createRelation({ fromId, toId, type }) {
    const clientResponse = getSupabaseClient();
    if (clientResponse.error || !clientResponse.client) {
      bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
      return;
    }

    const user = await getAuthenticatedUser(clientResponse.client);
    if (!user) return;

    if (fromId === toId) {
      bus.emit("output:append", "Não é permitido criar relação da nota com ela mesma.");
      return;
    }

    const { data: existing, error: existingError } = await clientResponse.client
      .from("note_relations")
      .select("from_note_id")
      .eq("from_note_id", fromId)
      .eq("to_note_id", toId)
      .eq("type", type)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      bus.emit("output:append", `Erro ao verificar relação na note_relations: ${existingError.message}`);
      return;
    }

    if (existing) {
      bus.emit("output:append", "Essa relação já existe.");
      return;
    }

    const { error: insertError } = await clientResponse.client
      .from("note_relations")
      .insert({
        from_note_id: fromId,
        to_note_id: toId,
        type,
        user_id: user.id,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        bus.emit("output:append", "Essa relação já existe.");
        return;
      }
      bus.emit("output:append", `Erro ao criar relação na note_relations: ${insertError.message}`);
      return;
    }

    bus.emit("output:append", `Relação criada: (${type}) ${fromId} -> ${toId}`);
    bus.emit("graph:refresh");
  }

  function startConfirmPrompt({ message, onConfirm }) {
    bus.emit("output:append", message);
    bus.emit("input:placeholder", "y");
    bus.emit("input:focus");
    bus.emit("router:capture:start", {
      echo: "normal",
      handler: async (value) => {
        bus.emit("router:capture:stop");
        bus.emit("input:placeholder", "");
        const normalized = value.trim().toLowerCase();
        if (normalized === "y" || normalized === "yes") {
          await onConfirm();
          return;
        }
        bus.emit("output:append", "Operação cancelada.");
      },
      onCancel: () => {
        bus.emit("router:capture:stop");
        bus.emit("input:placeholder", "");
        bus.emit("output:append", "Operação cancelada.");
      },
    });
  }

  function confirmDeleteNote(data) {
    if (!data?.id) return;
    clearDeleteBySubjectState();
    startConfirmPrompt({
      message: `Deletar nota "${data.subject ?? "(sem assunto)"}"? (y/n)`,
      onConfirm: async () => {
        const clientResponse = getSupabaseClient();
        if (clientResponse.error || !clientResponse.client) {
          bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
          return;
        }
        const user = await getAuthenticatedUser(clientResponse.client);
        if (!user) return;
        const { data: deleted, error } = await clientResponse.client
          .from("notes")
          .delete()
          .eq("id", data.id)
          .eq("user_id", user.id)
          .select("id");
        if (error) {
          bus.emit("output:append", `Erro ao deletar nota: ${error.message}`);
          return;
        }
        if (!deleted || deleted.length === 0) {
          bus.emit("output:append", "Nenhuma nota encontrada para deletar.");
          return;
        }
        bus.emit("output:append", `Nota ${data.id} removida.`);
        bus.emit("graph:refresh");
      },
    });
  }

  function confirmDeleteRelation(data) {
    if (!data?.from_note_id || !data?.to_note_id) return;
    clearDeleteBySubjectState();
    startConfirmPrompt({
      message: `Deletar relação (${data.type ?? "related"}) ${data.from_note_id} -> ${data.to_note_id}? (y/n)`,
      onConfirm: async () => {
        const clientResponse = getSupabaseClient();
        if (clientResponse.error || !clientResponse.client) {
          bus.emit("output:append", "Supabase não configurado. Use auth --register ou auth para autenticar.");
          return;
        }
        const user = await getAuthenticatedUser(clientResponse.client);
        if (!user) return;

        let query = clientResponse.client
          .from("note_relations")
          .delete()
          .eq("from_note_id", data.from_note_id)
          .eq("to_note_id", data.to_note_id)
          .eq("user_id", user.id);
        if (data.type) {
          query = query.eq("type", data.type);
        }

        const { data: deleted, error } = await query.select("from_note_id");
        if (error) {
          bus.emit("output:append", `Erro ao remover relação na note_relations: ${error.message}`);
          return;
        }
        if (!deleted || deleted.length === 0) {
          bus.emit("output:append", "Nenhuma relação encontrada para remover.");
          return;
        }
        bus.emit("output:append", `Relação removida (${deleted.length}).`);
        bus.emit("graph:refresh");
      },
    });
  }

  return { toggleGraph, openGraph, closeGraph, loadGraph };
}

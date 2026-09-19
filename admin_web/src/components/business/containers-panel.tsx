"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  ArrowLeft,
  ArrowRightLeft,
  Container,
  History,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Ship,
  Trash2,
  X,
} from "lucide-react";

import { runPanelAction } from "@/components/business/operations-panels";
import { confirmImportantAction } from "@/lib/action-confirmation";
import {
  useBusinessCollection,
  useBusinessDestinations,
  useBusinessStaff,
} from "@/lib/business-data";
import { canonicalMake, canonicalModel, getMakes, getModels, getYears } from "@/lib/car-catalog";
import {
  CONTAINER_MESSAGES,
  buildVinPlacementIndex,
  cleanVin,
  containerCallableFailure,
  containerDeleteRefusal,
  containerDraftFromRow,
  containerIsOpen,
  containerLineIsStock,
  containerLinePayload,
  containerLineTitle,
  containerMessage,
  containerPayload,
  containerRowCounts,
  containerStatus,
  containerTitle,
  containerTransitionRefusal,
  emptyContainerDraft,
  emptyContainerLineDraft,
  filterContainers,
  filterParkedCarPicks,
  lineDraftFromParkedCar,
  nextContainerStatus,
  openContainerHoldingVin,
  parkedCarPick,
  parkedCarsInLot,
  searchContainerLines,
  validateContainerDraft,
  validateContainerLineDraft,
  vinPlacementText,
  type ContainerDraft,
  type ContainerLineDraft,
  type ContainerLineInLot,
  type ContainerStatus,
  type ParkedCarPick,
} from "@/lib/container-manifest";
import {
  destinationCountryName,
  destinationCountryOptionForRow,
} from "@/lib/destination-countries";
import { db, functions } from "@/lib/firebase";
import { currentLanguage, formatDate, text } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  lotCustomerFromRow,
  lotCustomerFromStaffRow,
  lotCustomerSources,
  matchLotCustomers,
  type LotCustomer,
} from "@/lib/lot-customers";
import {
  VIN_LOOKING_UP,
  VIN_SERVICE_UNREACHABLE,
  decodeVinWithCatalog,
  findVehicleRecordByVin,
  vinDecodeHint,
} from "@/lib/vin-lookup";
import type { FirestoreRow } from "@/types/admin";

type Row = Record<string, unknown>;

type ContainersPanelProps = {
  businessId: string;
  previewMode?: boolean;
};

type ContainerModal = "" | "container" | "line" | "move" | "history";

const STATUS_LABELS: Record<ContainerStatus, string> = {
  loading: "Loading",
  shipped: "Shipped",
  arrived: "Arrived",
};

const STATUS_TONES: Record<ContainerStatus, string> = {
  loading: "warn",
  shipped: "navy",
  arrived: "ok",
};

function StatusBadge({ status }: { status: ContainerStatus }) {
  return <span className={`lst-badge ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>;
}

function EmptyState({ text: message }: { text: string }) {
  return <div className="empty-state">{message}</div>;
}

/**
 * The business's own loading lists: which box each car, set of barrels or
 * other cargo went into, when it sailed, and when it landed. Customers never
 * see this; it is the yard's record of what it declared.
 */
export function ContainersPanel({ businessId, previewMode = false }: ContainersPanelProps) {
  const enabled = Boolean(businessId && !previewMode);
  const containers = useBusinessCollection("containers", businessId, enabled, 500);
  const lines = useBusinessCollection("containerLines", businessId, enabled, 3000);
  const destinations = useBusinessDestinations(businessId, enabled, 100);
  const staff = useBusinessStaff(businessId, enabled, 200);
  // The same records the lot ledger's form scans when a VIN is typed: a
  // parked car or a past activity already says what the car is and whose.
  const parkedCars = useBusinessCollection("parkedCars", businessId, enabled, 500);
  const activities = useBusinessCollection("lotActivities", businessId, enabled, 1000);
  // The lot's customer memory, offered back as staff type a name.
  const lotCustomers = useBusinessCollection("lotCustomers", businessId, enabled, 500);

  const [statusFilter, setStatusFilter] = useState<"" | ContainerStatus>("");
  const [destinationFilter, setDestinationFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const [modal, setModal] = useState<ContainerModal>("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [draftError, setDraftError] = useState("");
  // Set alongside a `vin_already_loaded` refusal so the form can open the
  // container that already has the car instead of leaving the person to
  // hunt for it.
  const [conflictId, setConflictId] = useState("");

  const [containerDraft, setContainerDraft] = useState<ContainerDraft>(emptyContainerDraft);
  const [editingContainerId, setEditingContainerId] = useState("");
  const [lineDraft, setLineDraft] = useState<ContainerLineDraft>(emptyContainerLineDraft);
  const [vinHint, setVinHint] = useState("");
  const lastVinRef = useRef("");
  const [customerPick, setCustomerPick] = useState<LotCustomer | null>(null);
  const [customerMenuOpen, setCustomerMenuOpen] = useState(false);
  const [parkedFilter, setParkedFilter] = useState("");
  const [moveLineId, setMoveLineId] = useState("");
  const [moveTargetId, setMoveTargetId] = useState("");
  const [historyRows, setHistoryRows] = useState<FirestoreRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [documentLink, setDocumentLink] = useState("");

  const lang = currentLanguage() === "fr" ? "fr" : "en";

  const containerById = useMemo(() => {
    const map = new Map<string, FirestoreRow>();
    containers.rows.forEach((row) => map.set(String(row.id), row));
    return map;
  }, [containers.rows]);

  const linesByContainer = useMemo(() => {
    const map = new Map<string, FirestoreRow[]>();
    lines.rows.forEach((row) => {
      const key = text(row.containerId, "");
      if (!key) return;
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    });
    return map;
  }, [lines.rows]);

  const staffName = (id: string) => {
    if (!id) return "";
    const row = staff.rows.find((s) => String(s.id) === id);
    if (!row) return "";
    return text(row.fullName, "") || text(row.name, "") || text(row.email, "");
  };

  // The business's own destination list, labelled in the reader's language.
  // A destination a container was given that has since left the list is
  // folded back in so the picker never shows an empty choice for a real value.
  const destinationOptions = useMemo(() => {
    const options = destinations.rows.map((row) => {
      const option = destinationCountryOptionForRow(row);
      return {
        id: String(row.id),
        name: option.name,
        label: option.id ? destinationCountryName(option.id, lang) : option.name,
      };
    });
    options.sort((a, b) => a.label.localeCompare(b.label));
    return options;
  }, [destinations.rows, lang]);

  function destinationLabel(row: Row) {
    const id = text(row.destinationCountryId, "");
    if (!id) return "";
    const known = destinationOptions.find((option) => option.id === id);
    if (known) return known.label;
    const option = destinationCountryOptionForRow({ id, name: row.destinationCountryName });
    return option.id ? destinationCountryName(option.id, lang) : text(row.destinationCountryName, id);
  }

  const visibleContainers = useMemo(
    () => filterContainers(containers.rows, { status: statusFilter, destinationCountryId: destinationFilter }),
    [containers.rows, statusFilter, destinationFilter],
  );

  const searchHits = useMemo(
    () => searchContainerLines(lines.rows, containers.rows, search),
    [lines.rows, containers.rows, search],
  );
  const searching = search.trim().length >= 2;

  const selected = selectedId ? containerById.get(selectedId) : undefined;
  const selectedLines = selected ? linesByContainer.get(selectedId) ?? [] : [];
  const selectedOpen = selected ? containerIsOpen(selected) : false;
  const selectedStatus = selected ? containerStatus(selected) : "loading";
  const selectedCounts = selected ? containerRowCounts(selected, selectedLines) : null;

  // A container deleted or lost from the list closes its detail view.
  useEffect(() => {
    if (selectedId && !containers.loading && !containerById.has(selectedId)) {
      setSelectedId("");
    }
  }, [selectedId, containers.loading, containerById]);

  const loadingContainers = useMemo(
    () => containers.rows.filter((row) => containerIsOpen(row)),
    [containers.rows],
  );

  // Every VIN on a container that has not arrived — the same index the
  // parking list and the ledger use for their cross-links. Here it marks a
  // parked car as already taken before it can be picked.
  const vinPlacements = useMemo(
    () => buildVinPlacementIndex(lines.rows, containers.rows),
    [lines.rows, containers.rows],
  );
  // The cars in the lot right now, as the line form offers them. Built from
  // the parkedCars rows the VIN prefill already subscribes to — one list per
  // panel, not one per modal.
  const parkedPicks = useMemo(
    () => parkedCarsInLot(parkedCars.rows).map((row) => parkedCarPick(row, vinPlacements)),
    [parkedCars.rows, vinPlacements],
  );
  const visibleParkedPicks = useMemo(
    () => filterParkedCarPicks(parkedPicks, parkedFilter),
    [parkedPicks, parkedFilter],
  );

  const knownCustomers = useMemo(
    () =>
      lotCustomerSources(
        lotCustomers.rows.map((row) => lotCustomerFromRow(row)),
        staff.rows.map((row) => lotCustomerFromStaffRow(row)).filter((c): c is LotCustomer => c !== null),
      ),
    [lotCustomers.rows, staff.rows],
  );
  const customerMatches = useMemo(() => {
    if (!customerMenuOpen || customerPick) return [];
    const typed = lineDraft.customerName.trim();
    if (typed.length < 2) return knownCustomers.slice(0, 6);
    return matchLotCustomers(knownCustomers, typed);
  }, [knownCustomers, lineDraft.customerName, customerMenuOpen, customerPick]);

  function closeModal() {
    setModal("");
    setDraftError("");
    setConflictId("");
    setEditingContainerId("");
    setMoveLineId("");
    setMoveTargetId("");
  }

  function failInModal(error: unknown) {
    const failure = containerCallableFailure(error);
    setDraftError(failure.message);
    setConflictId(failure.conflictContainerId);
  }

  // -------------------------------------------------------------------------
  // The container.
  // -------------------------------------------------------------------------

  function openCreate() {
    setContainerDraft(emptyContainerDraft);
    setEditingContainerId("");
    setDraftError("");
    setModal("container");
  }

  function openEdit(row: FirestoreRow) {
    setContainerDraft(containerDraftFromRow(row));
    setEditingContainerId(String(row.id));
    setDraftError("");
    setModal("container");
  }

  function pickDestination(id: string) {
    const option = destinationOptions.find((o) => o.id === id);
    setContainerDraft((d) => ({
      ...d,
      destinationCountryId: id,
      destinationCountryName: option ? option.name : id ? d.destinationCountryName : "",
    }));
  }

  async function saveContainer() {
    const errors = validateContainerDraft(containerDraft);
    if (errors.length) {
      setDraftError(containerMessage(errors));
      return;
    }
    const payload = containerPayload(containerDraft);
    const editing = editingContainerId;
    const wasOpen = editing ? containerIsOpen(containerById.get(editing)) : true;
    await runPanelAction(setBusy, setFlash, editing ? "Container updated." : "Container started.", async () => {
      if (editing) {
        // A shipped container only takes a note; sending its identity back
        // unchanged is harmless, but sending only what may change keeps the
        // audit line honest.
        const changes = wasOpen ? payload : { notes: payload.notes };
        await httpsCallable(functions, "updateContainer")({ businessId, containerId: editing, changes });
      } else {
        const response = await httpsCallable(functions, "createContainer")({ businessId, ...payload });
        const data = (response.data ?? {}) as { containerId?: string };
        const id = text(data.containerId, "");
        if (id) setSelectedId(id);
      }
      closeModal();
    }, failInModal);
  }

  async function deleteContainer(row: FirestoreRow) {
    const refusal = containerDeleteRefusal(row, (linesByContainer.get(String(row.id)) ?? []).length);
    if (refusal) {
      setFlash(CONTAINER_MESSAGES[refusal]);
      return;
    }
    const ok = await confirmImportantAction(
      `Delete ${containerTitle(row)}? It has nothing on it, so nothing else changes.`,
      `Supprimer ${containerTitle(row)} ? Il est vide, rien d’autre ne change.`,
    );
    if (!ok) return;
    await runPanelAction(setBusy, setFlash, "Container deleted.", async () => {
      await httpsCallable(functions, "deleteContainer")({ businessId, containerId: String(row.id) });
      setSelectedId("");
    });
  }

  async function advance(row: FirestoreRow) {
    const next = nextContainerStatus(row);
    if (!next) return;
    const refusal = containerTransitionRefusal(row, next, (linesByContainer.get(String(row.id)) ?? []).length);
    if (refusal) {
      setFlash(CONTAINER_MESSAGES[refusal]);
      return;
    }
    const title = containerTitle(row);
    const ok = await confirmImportantAction(
      next === "shipped"
        ? `Mark ${title} as shipped? Today becomes its sailing date and the list is locked; only notes can change after this.`
        : `Mark ${title} as arrived? This closes the container.`,
      next === "shipped"
        ? `Marquer ${title} comme expédié ? Aujourd’hui devient sa date de départ et la liste est verrouillée ; seules les notes pourront changer ensuite.`
        : `Marquer ${title} comme arrivé ? Cela clôture le conteneur.`,
    );
    if (!ok) return;
    await runPanelAction(setBusy, setFlash, next === "shipped" ? "Marked as shipped." : "Marked as arrived.", async () => {
      await httpsCallable(functions, "setContainerStatus")({ businessId, containerId: String(row.id), status: next });
    });
  }

  async function openLoadingList(row: FirestoreRow) {
    setDocumentLink("");
    await runPanelAction(setBusy, setFlash, "", async () => {
      const response = await httpsCallable(functions, "getContainerDocumentUrl")({ businessId, containerId: String(row.id) });
      const data = (response.data ?? {}) as { url?: string };
      const url = text(data.url, "");
      if (!url) throw new Error("The loading list is not ready yet. Try again in a moment.");
      // Awaited call, so this open is outside the click gesture; a blocker can
      // refuse it. Leave the link on screen rather than a button that did nothing.
      const opened = window.open(url, "_blank", "noopener");
      if (!opened) setDocumentLink(url);
    });
  }

  async function openHistory(containerId: string) {
    setHistoryRows([]);
    setHistoryLoading(true);
    setModal("history");
    try {
      // Filter by businessId too: the security rule authorizes by business,
      // and Firestore rejects a query it can't prove stays inside that scope.
      const snap = await getDocs(query(
        collection(db, "lotLedgerAudit"),
        where("businessId", "==", businessId),
        where("entityId", "==", containerId),
        orderBy("at", "desc"),
        limit(50),
      ));
      setHistoryRows(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreRow)));
    } catch {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Lines.
  // -------------------------------------------------------------------------

  function openAddLine() {
    setLineDraft(emptyContainerLineDraft);
    setVinHint("");
    lastVinRef.current = "";
    setParkedFilter("");
    setCustomerPick(null);
    setCustomerMenuOpen(false);
    setDraftError("");
    setConflictId("");
    setModal("line");
  }

  // Changing what the line is starts the car over: the in-the-lot question
  // is asked again and nothing filled for a car survives into barrels.
  function setLineKind(kind: ContainerLineDraft["kind"]) {
    setVinHint("");
    lastVinRef.current = "";
    setConflictId("");
    setParkedFilter("");
    setLineDraft((d) => ({
      ...d,
      kind,
      inLot: "",
      parkedCarId: "",
      vinNumber: "",
      carMake: "",
      carModel: "",
      carYear: "",
    }));
  }

  // "Is this car parked in your lot?" — the first thing the car form asks.
  // Either answer clears whatever the other answer had filled: a picked car
  // must not leak its VIN into the typed flow, and a typed VIN must not sit
  // behind the pick list. The owner a pick filled goes with it.
  function answerInLot(inLot: ContainerLineInLot) {
    setVinHint("");
    lastVinRef.current = "";
    setConflictId("");
    setParkedFilter("");
    setCustomerPick(null);
    setCustomerMenuOpen(false);
    setLineDraft((d) => ({
      ...d,
      inLot,
      parkedCarId: "",
      vinNumber: "",
      carMake: "",
      carModel: "",
      carYear: "",
      customerName: d.parkedCarId ? "" : d.customerName,
      customerPhone: d.parkedCarId ? "" : d.customerPhone,
    }));
  }

  function pickParkedCar(pick: ParkedCarPick) {
    if (pick.takenBy) return;
    setCustomerPick(null);
    setCustomerMenuOpen(false);
    setConflictId("");
    // The VIN is known, so the decoder must not fire when the field renders.
    lastVinRef.current = pick.vin;
    setLineDraft((d) => lineDraftFromParkedCar(d, pick));
    setVinHint(recordHint(pick.car === "Car" ? "" : pick.car, pick.owner));
  }

  function pickCustomer(c: LotCustomer) {
    setCustomerPick(c);
    setCustomerMenuOpen(false);
    setLineDraft((d) => ({
      ...d,
      customerName: c.name || d.customerName,
      customerPhone: c.phone || d.customerPhone,
    }));
  }

  // Typing a VIN pulls the car and customer from an existing record for this
  // business (a parked car or a past activity), so staff don't re-key what
  // the lot already knows. Everything prefilled stays editable.
  function applyVin(rawVin: string) {
    const clean = cleanVin(rawVin);
    setLineDraft((d) => ({ ...d, vinNumber: clean }));
    setConflictId("");
    if (clean.length < 6) {
      setVinHint("");
      lastVinRef.current = "";
      return;
    }
    const match = findVehicleRecordByVin([...parkedCars.rows, ...activities.rows], clean);
    if (match) {
      lastVinRef.current = clean;
      setLineDraft((d) => ({
        ...d,
        carMake: text(match.carMake, d.carMake),
        carModel: text(match.carModel, d.carModel),
        carYear: text(match.carYear, d.carYear),
        customerName: d.customerName || text(match.customerName ?? match.ownerName, ""),
        customerPhone: d.customerPhone || text(match.customerPhone, ""),
      }));
      const car = [text(match.carYear, ""), text(match.carMake, ""), text(match.carModel, "")].filter(Boolean).join(" ");
      const who = text(match.customerName ?? match.ownerName, "");
      setVinHint(recordHint(car, who));
      return;
    }
    // The yard has never seen this VIN: decode it. Only on a full VIN, and once
    // per distinct one so it does not re-fire on every keystroke.
    setVinHint("");
    if (clean.length === 17 && clean !== lastVinRef.current) {
      lastVinRef.current = clean;
      void decodeLineVin(clean);
    }
  }

  async function decodeLineVin(vin: string) {
    setVinHint(VIN_LOOKING_UP);
    try {
      const result = await decodeVinWithCatalog(vin);
      // Ignore a stale response if the field has since changed.
      if (lastVinRef.current !== vin) return;
      if (result.make) {
        setLineDraft((d) => ({
          ...d,
          carMake: result.make,
          carModel: result.model || d.carModel,
          carYear: result.year || d.carYear,
        }));
      }
      setVinHint(vinDecodeHint(result));
    } catch {
      if (lastVinRef.current === vin) setVinHint(VIN_SERVICE_UNREACHABLE);
    }
  }

  async function saveLine() {
    if (!selected) return;
    const errors = validateContainerLineDraft(lineDraft);
    if (errors.length) {
      setDraftError(containerMessage(errors));
      return;
    }
    const line = containerLinePayload(lineDraft);
    // The same refusal the server gives, without the round trip: the rows are
    // already here, so a car on another open container is caught as typed.
    if (line.kind === "car") {
      const sameVin = lines.rows.filter((row) => cleanVin(row.vinNumber) === line.vinNumber);
      const conflict = openContainerHoldingVin(sameVin, selectedId);
      if (conflict) {
        setDraftError(CONTAINER_MESSAGES.vin_already_loaded);
        setConflictId(conflict);
        return;
      }
    }
    await runPanelAction(setBusy, setFlash, "Line added.", async () => {
      await httpsCallable(functions, "addContainerLine")({ businessId, containerId: selectedId, line });
      closeModal();
    }, failInModal);
  }

  async function removeLine(row: FirestoreRow) {
    if (!selected) return;
    const ok = await confirmImportantAction(
      `Remove ${containerLineTitle(row)} from ${containerTitle(selected)}?`,
      `Retirer ${containerLineTitle(row)} de ${containerTitle(selected)} ?`,
    );
    if (!ok) return;
    await runPanelAction(setBusy, setFlash, "Line removed.", async () => {
      await httpsCallable(functions, "removeContainerLine")({ businessId, containerId: selectedId, lineId: String(row.id) });
    });
  }

  function openMove(row: FirestoreRow) {
    setMoveLineId(String(row.id));
    setMoveTargetId("");
    setDraftError("");
    setModal("move");
  }

  async function moveLine() {
    if (!moveTargetId) {
      setDraftError(CONTAINER_MESSAGES.move_target_not_loading);
      return;
    }
    await runPanelAction(setBusy, setFlash, "Line moved.", async () => {
      await httpsCallable(functions, "moveContainerLine")({ businessId, lineId: moveLineId, toContainerId: moveTargetId });
      closeModal();
    }, failInModal);
  }

  // A car's fields wait behind the in-the-lot question: "no" shows the VIN
  // flow, "yes" shows them once a car is picked. Barrels and other cargo have
  // no such step.
  const carFieldsVisible = lineDraft.inLot === "no" || Boolean(lineDraft.parkedCarId);
  const ownerVisible = lineDraft.kind !== "car" || carFieldsVisible;
  const moveTargets = loadingContainers.filter((row) => String(row.id) !== selectedId);
  const movingLine = moveLineId ? selectedLines.find((row) => String(row.id) === moveLineId) : undefined;
  const conflictContainer = conflictId ? containerById.get(conflictId) : undefined;

  function jumpToConflict() {
    if (!conflictId) return;
    closeModal();
    setSearch("");
    setSelectedId(conflictId);
  }

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------

  const loading = containers.loading || lines.loading;
  const loadError = containers.error || lines.error;

  return (
    <div className="ctn-panel">
      {flash && (
        <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
          {flash} <button className="ghost-button" type="button" onClick={() => setFlash("")}>Dismiss</button>
        </div>
      )}
      {documentLink && (
        <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
          <a href={documentLink} target="_blank" rel="noopener noreferrer">Open the loading list</a>
        </div>
      )}
      {loadError && <div className="lst-form-error" role="alert">{loadError}</div>}

      {selected ? (
        <article className="panel">
          <div className="panel-header">
            <div>
              <button className="ghost-button" type="button" onClick={() => setSelectedId("")}><ArrowLeft size={14} /> All containers</button>
            </div>
            <span className="panel-action"><StatusBadge status={selectedStatus} /></span>
          </div>
          <div className="ctn-detail">
            <div className="ctn-detail-head">
              <div>
                <h2>{containerTitle(selected)}</h2>
                {text(selected.containerNumber, "") && text(selected.label, "") && <p className="panel-lede">{text(selected.label, "")}</p>}
              </div>
              <div className="ctn-detail-actions">
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => openEdit(selected)}>
                  <Pencil size={14} /> {selectedOpen ? "Edit" : "Add a note"}
                </button>
                <button className="lst-btn ghost" type="button" disabled={busy} aria-busy={busy} onClick={() => void openLoadingList(selected)}>
                  {busy ? <RefreshCw className="spin" size={14} /> : <Printer size={14} />} Loading list
                </button>
                <button className="lst-btn ghost" type="button" onClick={() => void openHistory(selectedId)}><History size={14} /> History</button>
                {selectedStatus === "loading" && (
                  <button className="lst-btn" type="button" disabled={busy} onClick={() => void advance(selected)}><Ship size={14} /> Mark shipped</button>
                )}
                {selectedStatus === "shipped" && (
                  <button className="lst-btn" type="button" disabled={busy} onClick={() => void advance(selected)}><Container size={14} /> Mark arrived</button>
                )}
                {selectedOpen && selectedLines.length === 0 && (
                  <button className="lst-btn ghost danger" type="button" disabled={busy} onClick={() => void deleteContainer(selected)}><Trash2 size={14} /> Delete</button>
                )}
              </div>
            </div>
            <div className="pur-info ctn-info">
              <div><span>Container number</span><b>{text(selected.containerNumber, "—")}</b></div>
              <div><span>Booking / BL reference</span><b>{text(selected.bookingReference, "—")}</b></div>
              <div><span>Destination</span><b>{destinationLabel(selected) || "—"}</b></div>
              <div><span>Started</span><b>{formatDate(selected.createdAt) || "—"}</b></div>
              {Boolean(selected.sailedAt) && <div><span>Sailed</span><b>{formatDate(selected.sailedAt)}</b></div>}
              {Boolean(selected.arrivedAt) && <div><span>Arrived</span><b>{formatDate(selected.arrivedAt)}</b></div>}
              {selectedCounts && (
                <div><span>On board</span><b>{selectedCounts.carCount} · {selectedCounts.barrelCount} · {selectedCounts.otherCount}</b><small>cars · barrels · other</small></div>
              )}
            </div>
            {text(selected.notes, "") && <p className="ctn-notes">{text(selected.notes, "")}</p>}
          </div>

          <div className="panel-header">
            <div><h3>Lines</h3><span className="panel-count">{selectedLines.length}</span></div>
            {selectedOpen && (
              <span className="panel-action">
                <button className="lst-add" type="button" disabled={busy} onClick={openAddLine}><Plus size={16} /> Add line</button>
              </span>
            )}
          </div>
          {selectedLines.length === 0 ? (
            <EmptyState text={selectedOpen ? "Nothing loaded yet. Add the first line." : "This container has no lines."} />
          ) : (
            <div className="mini-table">
              <div className="ctn-table">
                <div className="mini-table-head"><span>Cargo</span><span>Whose</span><span>Added</span><span aria-hidden="true"></span></div>
                {selectedLines.map((row) => {
                  const vin = cleanVin(row.vinNumber);
                  const title = containerLineTitle(row);
                  const stock = containerLineIsStock(row);
                  const by = staffName(text(row.addedByStaffId, ""));
                  return (
                    <div className="mini-table-row" key={String(row.id)}>
                      <span><strong>{title}</strong>{vin && vin !== title && <small>{vin}</small>}</span>
                      <span>
                        {stock ? <strong>Business stock</strong> : <strong>{text(row.customerName, "")}</strong>}
                        {!stock && <small>{text(row.customerPhone, "")}</small>}
                      </span>
                      <span><strong>{formatDate(row.createdAt)}</strong>{by && <small>{by}</small>}</span>
                      <span className="ctn-row-actions">
                        {selectedOpen && (
                          <>
                            <button className="ghost-button" type="button" disabled={busy} onClick={() => openMove(row)} title="Move to another container"><ArrowRightLeft size={14} /></button>
                            <button className="ghost-button" type="button" disabled={busy} onClick={() => void removeLine(row)} title="Remove line"><X size={14} /></button>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </article>
      ) : (
        <article className="panel">
          <div className="panel-header">
            <div><Container size={18} /><h2>Containers</h2><span className="panel-count">{visibleContainers.length}</span></div>
            <span className="panel-action">
              <button className="lst-add" type="button" disabled={busy || !enabled} onClick={openCreate}><Plus size={16} /> New container</button>
            </span>
          </div>
          <div className="panel-tools">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | ContainerStatus)} aria-label="Filter by state">
              <option value="">Every state</option>
              <option value="loading">Loading</option>
              <option value="shipped">Shipped</option>
              <option value="arrived">Arrived</option>
            </select>
            <select value={destinationFilter} onChange={(e) => setDestinationFilter(e.target.value)} aria-label="Filter by destination">
              <option value="">Every destination</option>
              {destinationOptions.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
            </select>
            <input type="search" placeholder="VIN, customer, phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search loaded cargo" />
          </div>
          <p className="panel-lede">Your own loading lists: what went into each box, when it sailed, and when it landed. Customers do not see this.</p>

          {searching ? (
            searchHits.length === 0 ? (
              <EmptyState text="Nothing loaded matches that search." />
            ) : (
              <div className="mini-table">
                <div className="ctn-table ctn-search-table">
                  <div className="mini-table-head"><span>Cargo</span><span>Whose</span><span>Container</span><span>State</span></div>
                  {searchHits.map((hit) => {
                    const vin = cleanVin(hit.line.vinNumber);
                    const title = containerLineTitle(hit.line);
                    const stock = containerLineIsStock(hit.line);
                    const containerId = text(hit.container?.id, "");
                    return (
                      <div
                        className="mini-table-row ctn-clickable"
                        key={String(hit.line.id)}
                        role="button"
                        tabIndex={0}
                        onClick={() => { if (containerId) { setSelectedId(containerId); } }}
                        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && containerId) { e.preventDefault(); setSelectedId(containerId); } }}
                      >
                        <span><strong>{title}</strong>{vin && vin !== title && <small>{vin}</small>}</span>
                        <span>
                          {stock ? <strong>Business stock</strong> : <strong>{text(hit.line.customerName, "")}</strong>}
                          {!stock && <small>{text(hit.line.customerPhone, "")}</small>}
                        </span>
                        <span><strong>{hit.container ? containerTitle(hit.container) : "—"}</strong>{hit.container && <small>{destinationLabel(hit.container)}</small>}</span>
                        <span><StatusBadge status={hit.status} />{Boolean(hit.sailedAt) && <small>{formatDate(hit.sailedAt)}</small>}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          ) : loading && containers.rows.length === 0 ? (
            <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
          ) : containers.rows.length === 0 ? (
            <EmptyState text="No containers yet. Start one when you begin loading a box." />
          ) : visibleContainers.length === 0 ? (
            <EmptyState text="No containers match this filter." />
          ) : (
            <div className="mini-table">
              <div className="ctn-table ctn-list-table">
                <div className="mini-table-head"><span>Container</span><span>Destination</span><span>On board</span><span>State</span></div>
                {visibleContainers.map((row) => {
                  const status = containerStatus(row);
                  const counts = containerRowCounts(row, linesByContainer.get(String(row.id)) ?? []);
                  const number = text(row.containerNumber, "");
                  const id = String(row.id);
                  return (
                    <div
                      className="mini-table-row ctn-clickable"
                      key={id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(id); } }}
                    >
                      <span><strong>{containerTitle(row)}</strong>{number && <small>{text(row.label, "")}</small>}</span>
                      <span><strong>{destinationLabel(row) || "—"}</strong>{text(row.bookingReference, "") && <small>{text(row.bookingReference, "")}</small>}</span>
                      <span><strong>{counts.carCount} · {counts.barrelCount} · {counts.otherCount}</strong><small>cars · barrels · other</small></span>
                      <span>
                        <StatusBadge status={status} />
                        {status === "shipped" && Boolean(row.sailedAt) && <small>{formatDate(row.sailedAt)}</small>}
                        {status === "arrived" && Boolean(row.arrivedAt) && <small>{formatDate(row.arrivedAt)}</small>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </article>
      )}

      {modal === "container" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div>
                <h3>{!editingContainerId ? "New container" : selectedOpen ? "Edit container" : "Add a note"}</h3>
                <p>{!editingContainerId
                  ? "Give it a working name now; the container number can come later."
                  : selectedOpen
                    ? "Name, number, reference and destination stay editable until it ships."
                    : "The list is the record of what went. A correction after sailing is written beside it, as a note."}</p>
              </div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <div className="lst-form-grid">
                {(!editingContainerId || selectedOpen) && (
                  <>
                    <label className="lst-field wide"><span>Working name</span><input value={containerDraft.label} onChange={(e) => setContainerDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Sailing 3 Oct, box 2" /></label>
                    <label className="lst-field"><span>Container number</span><input value={containerDraft.containerNumber} onChange={(e) => setContainerDraft((d) => ({ ...d, containerNumber: e.target.value.toUpperCase() }))} placeholder="e.g. MSKU1234567" /><small className="lst-hint">Four letters and seven digits, when the shipping line sends it.</small></label>
                    <label className="lst-field"><span>Booking / BL reference</span><input value={containerDraft.bookingReference} onChange={(e) => setContainerDraft((d) => ({ ...d, bookingReference: e.target.value }))} /></label>
                    <label className="lst-field wide"><span>Destination</span>
                      <select value={containerDraft.destinationCountryId} onChange={(e) => pickDestination(e.target.value)}>
                        <option value="">Not chosen yet</option>
                        {containerDraft.destinationCountryId && !destinationOptions.some((o) => o.id === containerDraft.destinationCountryId) && (
                          <option value={containerDraft.destinationCountryId}>{containerDraft.destinationCountryName || containerDraft.destinationCountryId}</option>
                        )}
                        {destinationOptions.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
                      </select>
                      {destinationOptions.length === 0 && <small className="lst-hint">Your destinations come from Services &amp; coverage.</small>}
                    </label>
                  </>
                )}
                <label className="lst-field wide"><span>Notes</span><textarea rows={3} value={containerDraft.notes} onChange={(e) => setContainerDraft((d) => ({ ...d, notes: e.target.value }))} /></label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void saveContainer()}>
                {busy ? <RefreshCw className="spin" size={16} /> : null}
                {busy ? "Saving..." : editingContainerId ? "Save" : "Start container"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === "line" && selected && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Add a line</h3><p>{containerTitle(selected)} — what went in, and whose it is.</p></div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {draftError && (
                <div className="lst-form-error" role="alert">
                  {draftError}
                  {conflictContainer && (
                    <> <button className="ghost-button" type="button" onClick={jumpToConflict}>Go to that container</button></>
                  )}
                </div>
              )}
              <fieldset className="lst-fieldset">
                <label className="lst-radio"><input type="radio" name="ctnkind" checked={lineDraft.kind === "car"} onChange={() => setLineKind("car")} /><span>A car</span></label>
                <label className="lst-radio"><input type="radio" name="ctnkind" checked={lineDraft.kind === "barrels"} onChange={() => setLineKind("barrels")} /><span>Barrels</span></label>
                <label className="lst-radio"><input type="radio" name="ctnkind" checked={lineDraft.kind === "other"} onChange={() => setLineKind("other")} /><span>Something else</span></label>
              </fieldset>
              {lineDraft.kind === "car" && (
                <fieldset className="lst-fieldset ctn-inlot">
                  <legend>Is this car parked in your lot?</legend>
                  <label className="lst-radio"><input type="radio" name="ctninlot" checked={lineDraft.inLot === "yes"} onChange={() => answerInLot("yes")} /><span>Yes</span></label>
                  <label className="lst-radio"><input type="radio" name="ctninlot" checked={lineDraft.inLot === "no"} onChange={() => answerInLot("no")} /><span>No</span></label>
                  {lineDraft.parkedCarId && (
                    <button className="ghost-button ctn-pick-again" type="button" onClick={() => answerInLot("yes")}>Pick another car</button>
                  )}
                </fieldset>
              )}
              {lineDraft.kind === "car" && lineDraft.inLot === "yes" && !lineDraft.parkedCarId && (
                <div className="ctn-pick">
                  {parkedPicks.length === 0 ? (
                    <div className="empty-state">
                      No cars are parked in your lot right now.
                      <button className="ghost-button" type="button" onClick={() => answerInLot("no")}>Enter the VIN instead</button>
                    </div>
                  ) : (
                    <>
                      <p className="lst-hint">Pick the car from your lot. It fills the VIN and the owner.</p>
                      <input type="search" placeholder="VIN, owner, make" aria-label="Filter parked cars" value={parkedFilter} onChange={(e) => setParkedFilter(e.target.value)} autoFocus />
                      {visibleParkedPicks.length === 0 ? (
                        <EmptyState text="No parked car matches that filter." />
                      ) : (
                        <div className="mini-table">
                          <div className="ctn-table ctn-pick-table">
                            <div className="mini-table-head"><span>Car</span><span>VIN</span><span>Owner</span></div>
                            {visibleParkedPicks.map((pick) => {
                              const taken = Boolean(pick.takenBy);
                              return (
                                <div
                                  className={`mini-table-row ${taken ? "ctn-pick-taken" : "ctn-clickable"}`}
                                  key={pick.id}
                                  role="button"
                                  tabIndex={taken ? -1 : 0}
                                  aria-disabled={taken}
                                  onClick={() => pickParkedCar(pick)}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickParkedCar(pick); } }}
                                >
                                  <span><strong>{pick.car}</strong>{taken && <small className="ctn-placement">{vinPlacementText(pick.takenBy, lang)}</small>}</span>
                                  <span><strong>{pick.vin || "—"}</strong></span>
                                  <span><strong>{pick.owner || "—"}</strong>{pick.phone && <small>{pick.phone}</small>}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <div className="lst-form-grid">
                {lineDraft.kind === "car" && carFieldsVisible && (
                  <>
                    <label className="lst-field wide"><span>VIN</span><input value={lineDraft.vinNumber} onChange={(e) => applyVin(e.target.value)} placeholder="17 characters" autoFocus />{vinHint && <small className="lst-hint" style={{ color: "var(--money)" }}>{vinHint}</small>}</label>
                    <label className="lst-field"><span>Car make</span>
                      <select value={canonicalMake(lineDraft.carMake) || lineDraft.carMake} onChange={(e) => setLineDraft((d) => ({ ...d, carMake: e.target.value, carModel: "", carYear: "" }))}>
                        <option value="">Select a make</option>
                        {getMakes().map((m) => (<option key={m} value={m}>{m}</option>))}
                      </select>
                    </label>
                    <label className="lst-field"><span>Car model</span>
                      <select disabled={!lineDraft.carMake} value={canonicalModel(lineDraft.carMake, lineDraft.carModel) || lineDraft.carModel} onChange={(e) => setLineDraft((d) => ({ ...d, carModel: e.target.value, carYear: "" }))}>
                        <option value="">Select a model</option>
                        {getModels(lineDraft.carMake).map((m) => (<option key={m} value={m}>{m}</option>))}
                      </select>
                    </label>
                    <label className="lst-field"><span>Car year</span>
                      <select disabled={!lineDraft.carModel} value={lineDraft.carYear} onChange={(e) => setLineDraft((d) => ({ ...d, carYear: e.target.value }))}>
                        <option value="">Select a year</option>
                        {getYears(lineDraft.carMake, lineDraft.carModel).map((y) => (<option key={y} value={y}>{y}</option>))}
                      </select>
                    </label>
                  </>
                )}
                {lineDraft.kind === "barrels" && (
                  <label className="lst-field"><span>How many barrels</span><input inputMode="numeric" value={lineDraft.quantity} onChange={(e) => setLineDraft((d) => ({ ...d, quantity: e.target.value }))} autoFocus /></label>
                )}
                {lineDraft.kind === "other" && (
                  <>
                    <label className="lst-field"><span>What it is</span><input value={lineDraft.description} onChange={(e) => setLineDraft((d) => ({ ...d, description: e.target.value }))} placeholder="e.g. tires, a generator" autoFocus /></label>
                    <label className="lst-field"><span>How many</span><input inputMode="numeric" value={lineDraft.quantity} onChange={(e) => setLineDraft((d) => ({ ...d, quantity: e.target.value }))} /></label>
                  </>
                )}
              </div>
              {ownerVisible && (
              <fieldset className="lst-fieldset">
                <label className="lst-radio"><input type="radio" name="ctnowner" checked={lineDraft.ownerKind === "customer"} onChange={() => setLineDraft((d) => ({ ...d, ownerKind: "customer" }))} /><span>A customer's — say who</span></label>
                <label className="lst-radio"><input type="radio" name="ctnowner" checked={lineDraft.ownerKind === "stock"} onChange={() => { setCustomerMenuOpen(false); setLineDraft((d) => ({ ...d, ownerKind: "stock", customerName: "", customerPhone: "" })); }} /><span>Business stock — your own goods, nobody to name</span></label>
              </fieldset>
              )}
              {ownerVisible && lineDraft.ownerKind === "customer" && (
                <div className="lst-form-grid">
                  <label className="lst-field" style={{ position: "relative" }}><span>Customer</span>
                    <input value={lineDraft.customerName} autoComplete="off" onFocus={() => setCustomerMenuOpen(true)} onBlur={() => window.setTimeout(() => setCustomerMenuOpen(false), 150)} onChange={(e) => { setCustomerPick(null); setCustomerMenuOpen(true); setLineDraft((d) => ({ ...d, customerName: e.target.value })); }} />
                    {customerMatches.length > 0 && (
                      <ul className="lst-suggest" role="listbox" aria-label="Saved customers">
                        {customerMatches.map((c) => (
                          <li key={c.id} role="option" aria-selected={false}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustomer(c)}><strong>{c.name}</strong><small>{c.phone}</small></button></li>
                        ))}
                      </ul>
                    )}
                  </label>
                  <label className="lst-field"><span>Phone</span><input value={lineDraft.customerPhone} onChange={(e) => setLineDraft((d) => ({ ...d, customerPhone: e.target.value }))} /></label>
                </div>
              )}
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy || !ownerVisible} aria-busy={busy} onClick={() => void saveLine()}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />}
                {busy ? "Saving..." : "Add line"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === "move" && movingLine && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Move line</h3><p>{containerLineTitle(movingLine)} goes to another container that is still loading.</p></div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              {moveTargets.length === 0 ? (
                <EmptyState text="No other container is loading right now. Start one first." />
              ) : (
                <label className="lst-field wide"><span>Move to</span>
                  <select value={moveTargetId} onChange={(e) => setMoveTargetId(e.target.value)}>
                    <option value="">Choose a container</option>
                    {moveTargets.map((row) => (<option key={String(row.id)} value={String(row.id)}>{containerTitle(row)}{destinationLabel(row) ? ` — ${destinationLabel(row)}` : ""}</option>))}
                  </select>
                </label>
              )}
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy || moveTargets.length === 0} aria-busy={busy} onClick={() => void moveLine()}>
                {busy ? <RefreshCw className="spin" size={16} /> : <ArrowRightLeft size={16} />}
                {busy ? "Moving..." : "Move line"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === "history" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>Change history</h3><p>Every change on this container, most recent first.</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              {historyLoading ? <p className="panel-lede">Loading…</p> : historyRows.length === 0 ? <EmptyState text="No changes recorded yet." /> : historyRows.map((h) => {
                const who = staffName(text(h.byStaffId, "")) || (text(h.byStaffId, "") ? "someone not on your team" : "an unknown user");
                return (
                  <div key={String(h.id)} style={{ padding: "10px 0", borderBottom: "1px solid var(--rule)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span><strong>{auditActionLabel(text(h.action, ""))}</strong> · {who}</span>
                      <small style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{formatDate(h.at)}</small>
                    </div>
                    {text(h.summary, "") && <div style={{ marginTop: 2 }}><small>{text(h.summary, "")}</small></div>}
                  </div>
                );
              })}
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" onClick={closeModal}>Done</button></footer>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Filled from an existing record: 2019 Toyota Camry for Aissatou. You can change anything below." */
function recordHint(car: string, who: string) {
  return `Filled from an existing record${car ? `: ${car}` : ""}${who ? ` for ${who}` : ""}. You can change anything below.`;
}

/** The audit actions the server writes for a container, as a word. */
function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    created: "Started",
    edited: "Edited",
    line_added: "Line added",
    line_removed: "Line removed",
    line_moved: "Line moved",
    shipped: "Shipped",
    arrived: "Arrived",
    deleted: "Deleted",
  };
  return labels[action] ?? "Changed";
}

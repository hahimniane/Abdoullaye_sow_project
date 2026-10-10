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
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Ship,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { runPanelAction } from "@/components/business/operations-panels";
import { confirmImportantAction } from "@/lib/action-confirmation";
import {
  useActiveParkedCars,
  useBusinessCollection,
  useBusinessDestinations,
  useBusinessStaff,
  useLiveDoc,
  useWaitingPackages,
} from "@/lib/business-data";
import { useDocsWhereIn } from "@/lib/use-paged-query";
import { findBusinessVehicleRecord } from "@/lib/vin-records";
import { LoadMoreButton } from "@/components/show-more";
import { canonicalMake, canonicalModel, getMakes, getModels, getYears } from "@/lib/car-catalog";
import { useCarCatalog } from "@/lib/use-car-catalog";
import {
  CONTAINER_MESSAGES,
  LINE_STAGE_LABELS,
  LINE_STAGE_TONES,
  buildVinPlacementIndex,
  cleanVin,
  containerCallableFailure,
  containerDeleteRefusal,
  containerDraftFromRow,
  containerIsOpen,
  containerLineContactsDraftFromRow,
  containerLineDraftFromRow,
  containerLineIsStock,
  containerLinePayload,
  containerLineTitle,
  containerLineWhatsApp,
  containerLineWhatsAppText,
  contactPhoneReach,
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
  phoneCountryForBusiness,
  phoneCountryForDestination,
  searchContainerLines,
  updateContainerLineContactsRequest,
  updateContainerLineRequest,
  validateContainerDraft,
  validateContainerLineContactsDraft,
  validateContainerLineDraft,
  vinPlacementText,
  type ContainerDraft,
  type ContainerLineContactsDraft,
  type ContainerLineDraft,
  type ContainerLineInLot,
  type ContainerStatus,
  type LineStage,
  type ParkedCarPick,
} from "@/lib/container-manifest";
import { defaultWaitingDestination } from "@/lib/waiting-packages";
import {
  DESTINATION_COUNTRIES,
  destinationCountryName,
  destinationCountryOptionForRow,
} from "@/lib/destination-countries";
import { db, functions } from "@/lib/firebase";
import { currentLanguage, formatDate, text } from "@/lib/format";
import { staffNameFrom, staffNameIndex } from "@/lib/staff-names";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { closePendingTab, openPendingTab, sendPendingTab } from "@/lib/pending-tab";
import { CopyValue } from "@/components/copy-value";
import { ContainerLabelsDialog } from "@/components/business/container-labels-dialog";
import { AddWaitingPackagesDialog } from "@/components/business/add-waiting-packages-dialog";
import { ContactPhone } from "@/components/business/contact-phone";
import { PackageMoney, PackageSize, WaitingPackagesPanel } from "@/components/business/waiting-packages-panel";
import { CustomerPhoneField } from "@/components/customer-phone-field";
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
import { statusPillClass } from "@/lib/status-pill";
import type { FirestoreRow } from "@/types/admin";

type Row = Record<string, unknown>;

type ContainersPanelProps = {
  businessId: string;
  /** The business record, for the country its customers' phones default to. */
  business?: FirestoreRow | null;
  previewMode?: boolean;
  /**
   * Opened from a link (a package's "Open in business console"): the
   * container to open, and the line on it to mark and scroll to.
   */
  focusContainerId?: string;
  focusLineId?: string;
};

type ContainerModal = "" | "container" | "line" | "move" | "history" | "contacts" | "labels" | "assign";

/** The two lists the panel offers: the containers, and the packages still waiting for one. */
type ListView = "containers" | "waiting";

function StatusBadge({ status }: { status: LineStage }) {
  return <span className={statusPillClass(LINE_STAGE_TONES[status])}>{LINE_STAGE_LABELS[status]}</span>;
}

function EmptyState({ text: message }: { text: string }) {
  return <div className="empty-state">{message}</div>;
}

/** The line's tracking code — what the customer types to follow it — with a copy. */
function LineTrackingCode({ code }: { code: string }) {
  if (!code) return null;
  return (
    <small className="ctn-code-row">
      <code className="ctn-code" data-no-translate>{code}</code>
      <CopyValue value={code} label="Copy tracking code" />
    </small>
  );
}

/** Who hears about this line on WhatsApp, and which number cannot be reached yet. */
function LineWhatsApp({ line }: { line: Row }) {
  const { summary, warnings } = containerLineWhatsAppText(containerLineWhatsApp(line));
  return (
    <>
      <small className="ctn-wa">{summary}</small>
      {warnings.map((warning) => (
        <small className="ctn-wa-warn" key={warning}>{warning}</small>
      ))}
    </>
  );
}

/**
 * The business's own loading lists: which box each car, set of barrels or
 * other cargo went into, when it sailed, and when it landed. Customers never
 * see this; it is the yard's record of what it declared.
 */
export function ContainersPanel({
  businessId,
  business = null,
  previewMode = false,
  focusContainerId = "",
  focusLineId = "",
}: ContainersPanelProps) {
  // Loads the make/model/year catalog on demand; re-renders when it is in.
  useCarCatalog();
  const enabled = Boolean(businessId && !previewMode);
  // Every container still loading or at sea, whole and live; the arrived
  // ones - history that only grows - newest arrival first, a page at a time.
  const openContainers = useBusinessCollection("containers", businessId, enabled, {
    pageSize: null,
    where: [["status", "in", ["loading", "shipped"]]],
  });
  const arrivedContainers = useBusinessCollection("containers", businessId, enabled, {
    pageSize: 25,
    orderBy: "arrivedAt",
    where: [["status", "==", "arrived"]],
    sort: "query",
  });
  // A container opened from a link may be an arrival older than the page
  // loaded above: read that one document so it opens all the same. Only this
  // business's own; another business's id opens nothing.
  const linkedContainer = useLiveDoc("containers", focusContainerId, enabled && Boolean(focusContainerId));
  const linkedRow = linkedContainer && text(linkedContainer.businessId, "") === businessId ? linkedContainer : null;
  const containerRows = useMemo(() => {
    const rows = [...openContainers.rows, ...arrivedContainers.rows];
    if (linkedRow && !rows.some((row) => String(row.id) === String(linkedRow.id))) rows.push(linkedRow);
    return rows;
  }, [openContainers.rows, arrivedContainers.rows, linkedRow]);
  const containers = {
    rows: containerRows,
    loading: openContainers.loading || arrivedContainers.loading,
    error: openContainers.error || arrivedContainers.error,
  };
  // The lines of the containers on screen - never the business's whole
  // loading history.
  const containerIds = useMemo(() => containerRows.map((row) => String(row.id)), [containerRows]);
  const lines = useDocsWhereIn({
    collection: "containerLines",
    field: "containerId",
    values: containerIds,
    filters: [["businessId", "==", businessId]],
    enabled,
  });
  // Packages dropped off and not on a container yet: their own list, and
  // searchable beside the loaded lines.
  const waiting = useWaitingPackages(businessId, enabled);
  const destinations = useBusinessDestinations(businessId, enabled);
  const staff = useBusinessStaff(businessId, enabled);
  // The cars in the lot right now (the line form offers them), whole and
  // live: the stays that have not ended.
  const parkedCars = useActiveParkedCars(businessId, enabled);
  // The lot's customer memory, offered back as staff type a name: the people
  // seen most recently first.
  const lotCustomers = useBusinessCollection("lotCustomers", businessId, enabled, {
    pageSize: 300,
    orderBy: "lastSeenAt",
    sort: "query",
  });

  const [statusFilter, setStatusFilter] = useState<"" | ContainerStatus>("");
  const [destinationFilter, setDestinationFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<ListView>("containers");

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
  // The line the form is editing; "" when it is adding a new one. The same
  // form and draft serve both.
  const [editingLineId, setEditingLineId] = useState("");
  // Lines saved from this one opening of the form. Five barrels for three
  // customers are three lines, entered back to back without closing it.
  const [addedThisSitting, setAddedThisSitting] = useState<string[]>([]);
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
  // The line whose contacts are being corrected, and the form for it.
  const [contactsLineId, setContactsLineId] = useState("");
  const [contactsDraft, setContactsDraft] = useState<ContainerLineContactsDraft>(() => containerLineContactsDraftFromRow({}));
  // Package labels: the container they print for, and the one line when it
  // is a reprint for one shipment. The dialog holds the format, the count and
  // the fallback link.
  const [labelsContainerId, setLabelsContainerId] = useState("");
  const [labelsLineId, setLabelsLineId] = useState("");

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

  // Built once per staff list, read per row (never a find() per row).
  const staffNames = useMemo(() => staffNameIndex(staff.rows), [staff.rows]);
  const staffName = (id: string) => staffNameFrom(staffNames, id);

  // The business's own destination list, labelled in the reader's language,
  // offered first; then every other country. A container goes wherever the
  // business sends it - cars bought here and sold in Conakry need no barrel
  // service to Guinea - so the picker is never limited to what Services &
  // coverage lists, and a business that has listed nothing still has the
  // whole world to choose from.
  const destinationOptions = useMemo(() => {
    const own = destinations.rows.map((row) => {
      const option = destinationCountryOptionForRow(row);
      return {
        id: String(row.id),
        name: option.name,
        label: option.id ? destinationCountryName(option.id, lang) : option.name,
      };
    });
    own.sort((a, b) => a.label.localeCompare(b.label));
    const ownIds = new Set(own.map((o) => o.id));
    const rest = DESTINATION_COUNTRIES
      .filter((c) => !ownIds.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, label: destinationCountryName(c.id, lang) }));
    rest.sort((a, b) => a.label.localeCompare(b.label));
    return { own, rest, all: [...own, ...rest] };
  }, [destinations.rows, lang]);

  // The filter lists only destinations a container actually has, so it stays
  // a handful of choices rather than every country.
  const destinationFilterOptions = useMemo(() => {
    const used = new Set(containers.rows.map((row) => text(row.destinationCountryId, "")).filter(Boolean));
    return destinationOptions.all.filter((o) => used.has(o.id));
  }, [containers.rows, destinationOptions]);

  const destinationLabels = useMemo(
    () => new Map(destinationOptions.all.map((option) => [option.id, option.label])),
    [destinationOptions],
  );
  function destinationLabel(row: Row) {
    const id = text(row.destinationCountryId, "");
    if (!id) return "";
    const known = destinationLabels.get(id);
    if (known !== undefined) return known;
    const option = destinationCountryOptionForRow({ id, name: row.destinationCountryName });
    return option.id ? destinationCountryName(option.id, lang) : text(row.destinationCountryName, id);
  }

  const visibleContainers = useMemo(
    () => filterContainers(containers.rows, { status: statusFilter, destinationCountryId: destinationFilter }),
    [containers.rows, statusFilter, destinationFilter],
  );

  const searchHits = useMemo(
    () => searchContainerLines([...lines.rows, ...waiting.rows], containers.rows, search),
    [lines.rows, waiting.rows, containers.rows, search],
  );
  const searching = search.trim().length >= 2;

  const selected = selectedId ? containerById.get(selectedId) : undefined;
  const selectedLines = selected ? linesByContainer.get(selectedId) ?? [] : [];
  const selectedOpen = selected ? containerIsOpen(selected) : false;
  const selectedStatus = selected ? containerStatus(selected) : "loading";
  const selectedCounts = selected ? containerRowCounts(selected, selectedLines) : null;

  // New packages open on the main destination (or the first one listed).
  const waitingDestination = useMemo(() => defaultWaitingDestination(destinations.rows), [destinations.rows]);

  // Where the phone pickers open: the business's own country for the
  // customer handing the goods in, the container's destination for whoever
  // collects them there.
  const customerPhoneCountry = useMemo(() => phoneCountryForBusiness(business), [business]);
  const receiverPhoneCountry = selected
    ? phoneCountryForDestination(selected, customerPhoneCountry, destinations.rows)
    : customerPhoneCountry;

  // A link opens its container once, as soon as the container is known; a
  // container that never turns up leaves the list as it is.
  const focusOpened = useRef(false);
  useEffect(() => {
    if (focusOpened.current || !focusContainerId || !containerById.has(focusContainerId)) return;
    focusOpened.current = true;
    setSelectedId(focusContainerId);
  }, [focusContainerId, containerById]);
  // Then its line is scrolled into view once it has rendered.
  const focusScrolled = useRef(false);
  useEffect(() => {
    if (focusScrolled.current || !focusLineId || selectedId !== focusContainerId) return;
    const row = document.getElementById(`ctn-line-${focusLineId}`);
    if (!row) return;
    focusScrolled.current = true;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusLineId, focusContainerId, selectedId, lines.rows]);

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
    setEditingLineId("");
    setMoveLineId("");
    setMoveTargetId("");
    setContactsLineId("");
    setLabelsContainerId("");
    setLabelsLineId("");
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
    const option = destinationOptions.all.find((o) => o.id === id);
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
    // Opened inside the click, before the await, so a popup blocker lets it
    // through; it is pointed at the list once the server answers.
    const tab = openPendingTab(window);
    await runPanelAction(setBusy, setFlash, "", async () => {
      const response = await httpsCallable(functions, "getContainerDocumentUrl")({ businessId, containerId: String(row.id) });
      const data = (response.data ?? {}) as { url?: string };
      const url = text(data.url, "");
      if (!url) throw new Error("The loading list is not ready yet. Try again in a moment.");
      // Blocked even so: leave the link on screen rather than a button that did nothing.
      if (!sendPendingTab(tab, url)) setDocumentLink(url);
    }, () => closePendingTab(tab));
  }

  // Labels print in every state: a torn label needs replacing most once the
  // box has sailed. `line` scopes the sheet to that line's packages.
  function openLabels(containerId: string, line?: Row) {
    if (!containerId) return;
    setLabelsContainerId(containerId);
    setLabelsLineId(line ? String(line.id) : "");
    setDraftError("");
    setConflictId("");
    setModal("labels");
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
    setEditingLineId("");
    setAddedThisSitting([]);
    setVinHint("");
    lastVinRef.current = "";
    setParkedFilter("");
    setCustomerPick(null);
    setCustomerMenuOpen(false);
    setDraftError("");
    setConflictId("");
    setModal("line");
  }

  // The add-line form, pre-filled with a line already on the list. Only
  // while the container loads: after that the list is the record of what
  // went, and only the contacts change (Edit contacts).
  function openEditLine(row: FirestoreRow) {
    const draft = containerLineDraftFromRow(row);
    setLineDraft(draft);
    setEditingLineId(String(row.id));
    setAddedThisSitting([]);
    setVinHint("");
    // The VIN is the line's own, so the decoder must not fire on render.
    lastVinRef.current = draft.vinNumber;
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
    const match = findVehicleRecordByVin(parkedCars.rows, clean);
    if (match) {
      lastVinRef.current = clean;
      fillFromRecord(match);
      return;
    }
    // Not a car in the lot now: a full VIN asks the lot's records (one
    // lookup each), then the decoder - once per distinct VIN.
    setVinHint("");
    if (clean.length === 17 && clean !== lastVinRef.current) {
      lastVinRef.current = clean;
      void lookupLineVin(clean);
    }
  }

  async function lookupLineVin(vin: string) {
    setVinHint(VIN_LOOKING_UP);
    const match = await findBusinessVehicleRecord(businessId, vin);
    if (lastVinRef.current !== vin) return;
    if (match) {
      fillFromRecord(match);
      return;
    }
    await decodeLineVin(vin);
  }

  function fillFromRecord(match: Record<string, unknown>) {
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

  // `andAnother` keeps the form open after the save with the same kind of
  // cargo selected and the customer cleared, for the next customer's share.
  async function saveLine(andAnother = false) {
    if (!selected) return;
    const errors = validateContainerLineDraft(lineDraft);
    if (errors.length) {
      setDraftError(containerMessage(errors));
      return;
    }
    const line = containerLinePayload(lineDraft);
    const editing = editingLineId ? lines.rows.find((row) => String(row.id) === editingLineId) : undefined;
    // The same refusal the server gives, without the round trip: the rows are
    // already here, so a car on another open container is caught as typed.
    // An edited line never conflicts with itself.
    if (line.kind === "car") {
      const sameVin = lines.rows.filter((row) =>
        cleanVin(row.vinNumber) === line.vinNumber && String(row.id) !== editingLineId);
      const conflict = editingLineId ? openContainerHoldingVin(sameVin) : openContainerHoldingVin(sameVin, selectedId);
      if (conflict) {
        setDraftError(CONTAINER_MESSAGES.vin_already_loaded);
        setConflictId(conflict);
        return;
      }
    }
    if (editingLineId) {
      if (!editing) {
        setDraftError(CONTAINER_MESSAGES.line_not_found);
        return;
      }
      await runPanelAction(setBusy, setFlash, "Line updated.", async () => {
        await httpsCallable(functions, "updateContainerLine")(updateContainerLineRequest(businessId, editing, lineDraft));
        closeModal();
      }, failInModal);
      return;
    }
    await runPanelAction(setBusy, setFlash, andAnother ? "" : "Line added.", async () => {
      await httpsCallable(functions, "addContainerLine")({ businessId, containerId: selectedId, line });
      if (!andAnother) {
        closeModal();
        return;
      }
      // "1 barrel" / "3 barrels" / "2 × tires": the list's own wording.
      const what = containerLineTitle(line);
      const whose = line.customerName || "Business stock";
      setAddedThisSitting((list) => [...list, `${what} — ${whose}${line.receiverName ? ` → ${line.receiverName}` : ""}`]);
      setCustomerPick(null);
      setCustomerMenuOpen(false);
      setDraftError("");
      setLineDraft((d) => ({ ...emptyContainerLineDraft, kind: d.kind, description: d.description, ownerKind: d.ownerKind }));
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

  // While the container loads, a package can leave it again: back to the
  // waiting list, same label, same code.
  async function sendBackToWaiting(row: FirestoreRow) {
    if (!selected) return;
    const ok = await confirmImportantAction(
      `Send ${containerLineTitle(row)} back to waiting? It leaves ${containerTitle(selected)}; its label and code stay the same.`,
      `Remettre ${containerLineTitle(row)} en attente ? Il quitte ${containerTitle(selected)} ; son étiquette et son code ne changent pas.`,
    );
    if (!ok) return;
    await runPanelAction(setBusy, setFlash, "Package sent back to waiting.", async () => {
      await httpsCallable(functions, "unassignContainerLine")({ businessId, lineId: String(row.id) });
    });
  }

  // Contacts stay correctable in every state: a wrong number matters most
  // once the box has sailed.
  function openContacts(row: FirestoreRow) {
    setContactsLineId(String(row.id));
    setContactsDraft(containerLineContactsDraftFromRow(row));
    setDraftError("");
    setConflictId("");
    setModal("contacts");
  }

  async function saveContacts() {
    const line = contactsLineId ? lines.rows.find((row) => String(row.id) === contactsLineId) : undefined;
    if (!line) return;
    const errors = validateContainerLineContactsDraft(contactsDraft, line);
    if (errors.length) {
      setDraftError(containerMessage(errors));
      return;
    }
    await runPanelAction(setBusy, setFlash, "Contacts updated.", async () => {
      await httpsCallable(functions, "updateContainerLineContacts")(updateContainerLineContactsRequest(businessId, line, contactsDraft));
      closeModal();
    }, failInModal);
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
  const contactsLine = contactsLineId ? lines.rows.find((row) => String(row.id) === contactsLineId) : undefined;
  const contactsLineContainer = contactsLine ? containerById.get(text(contactsLine.containerId, "")) : undefined;
  const labelsContainer = labelsContainerId ? containerById.get(labelsContainerId) : undefined;
  const labelsLine = labelsLineId ? lines.rows.find((row) => String(row.id) === labelsLineId) : undefined;
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

  // The two lists the panel offers, with how many each holds.
  const viewTabs = (
    <div className="service-segments" role="tablist" aria-label="Container lists">
      {([["containers", "Containers", containers.rows.length], ["waiting", "Waiting list", waiting.rows.length]] as [ListView, string, number][]).map(([id, label, count]) => (
        <span
          key={id}
          role="button"
          tabIndex={0}
          className={`segment ${view === id ? "active" : ""}`}
          aria-pressed={view === id}
          onClick={() => setView(id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView(id); } }}
        >
          {label}<b>{count}</b>
        </span>
      ))}
    </div>
  );

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
                <h2 data-no-translate>{containerTitle(selected)}</h2>
                {text(selected.containerNumber, "") && text(selected.label, "") && <p className="panel-lede" data-no-translate>{text(selected.label, "")}</p>}
              </div>
              <div className="ctn-detail-actions">
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => openEdit(selected)}>
                  <Pencil size={14} /> {selectedOpen ? "Edit" : "Add a note"}
                </button>
                <button className="lst-btn ghost" type="button" disabled={busy} aria-busy={busy} onClick={() => void openLoadingList(selected)}>
                  {busy ? <RefreshCw className="spin" size={14} /> : <Printer size={14} />} Loading list
                </button>
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => openLabels(selectedId)}>
                  <Tag size={14} /> Print labels
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
              <div><span>Container number</span><b data-no-translate>{text(selected.containerNumber, "—")}</b></div>
              <div><span>Booking / BL reference</span><b data-no-translate>{text(selected.bookingReference, "—")}</b></div>
              <div><span>Destination</span><b>{destinationLabel(selected) || "—"}</b></div>
              <div><span>Started</span><b>{formatDate(selected.createdAt) || "—"}</b></div>
              {Boolean(selected.sailedAt) && <div><span>Sailed</span><b>{formatDate(selected.sailedAt)}</b></div>}
              {Boolean(selected.arrivedAt) && <div><span>Arrived</span><b>{formatDate(selected.arrivedAt)}</b></div>}
              {selectedCounts && (
                <div><span>On board</span><b>{selectedCounts.carCount} · {selectedCounts.barrelCount} · {selectedCounts.otherCount}</b><small>cars · barrels · other</small></div>
              )}
            </div>
            {text(selected.notes, "") && <p className="ctn-notes" data-no-translate>{text(selected.notes, "")}</p>}
          </div>

          <div className="panel-header">
            <div><h3>Lines</h3><span className="panel-count">{selectedLines.length}</span></div>
            {selectedOpen && (
              <span className="panel-action">
                <button className="lst-btn ghost" type="button" disabled={busy || waiting.rows.length === 0} onClick={() => setModal("assign")}><Plus size={16} /> Add waiting packages</button>
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
                    <div
                      className={`mini-table-row${focusLineId && String(row.id) === focusLineId ? " ctn-line-focus" : ""}`}
                      id={`ctn-line-${String(row.id)}`}
                      key={String(row.id)}
                    >
                      <span><strong data-no-translate>{title}</strong>{vin && vin !== title && <small data-no-translate>{vin}</small>}{vin && <CopyValue value={vin} label="Copy VIN" />}<LineTrackingCode code={text(row.trackingCode, "")} /><PackageSize line={row} /><PackageMoney line={row} /></span>
                      <span>
                        {stock ? <strong>Business stock</strong> : <strong data-no-translate>{text(row.customerName, "")}</strong>}
                        {!stock && <small data-no-translate>{text(row.customerPhone, "")}</small>}
                        {text(row.receiverName, "") && <small data-no-translate>→ {text(row.receiverName, "")}{text(row.receiverPhone, "") ? ` · ${text(row.receiverPhone, "")}` : ""}</small>}
                        <LineWhatsApp line={row} />
                      </span>
                      <span><strong>{formatDate(row.createdAt)}</strong>{by && <small data-no-translate>{by}</small>}</span>
                      <span className="ctn-row-actions">
                        <button className="ghost-button" type="button" disabled={busy} onClick={() => openLabels(selectedId, row)} title="Print labels" aria-label="Print labels"><Tag size={14} /></button>
                        <button className="ghost-button" type="button" disabled={busy} onClick={() => openContacts(row)} title="Edit contacts" aria-label="Edit contacts"><Phone size={14} /></button>
                        {selectedOpen && (
                          <>
                            <button className="ghost-button" type="button" disabled={busy} onClick={() => openEditLine(row)} title="Edit line" aria-label="Edit line"><Pencil size={14} /></button>
                            <button className="ghost-button" type="button" disabled={busy} onClick={() => openMove(row)} title="Move to another container"><ArrowRightLeft size={14} /></button>
                            <button className="ghost-button" type="button" disabled={busy} onClick={() => void sendBackToWaiting(row)} title="Send back to waiting" aria-label="Send back to waiting"><Undo2 size={14} /></button>
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
      ) : view === "waiting" ? (
        <WaitingPackagesPanel
          businessId={businessId}
          rows={waiting.rows}
          loading={waiting.loading}
          error={waiting.error}
          tabs={viewTabs}
          destinationOptions={destinationOptions}
          defaultDestination={waitingDestination}
          destinationRows={destinations.rows}
          customerPhoneCountry={customerPhoneCountry}
          knownCustomers={knownCustomers}
          staffName={staffName}
          onFlash={setFlash}
          enabled={enabled}
        />
      ) : (
        <article className="panel">
          <div className="panel-header">
            <div><Container size={18} /><h2>Containers</h2><span className="panel-count">{visibleContainers.length}</span></div>
            <span className="panel-action">
              <button className="lst-add" type="button" disabled={busy || !enabled} onClick={openCreate}><Plus size={16} /> New container</button>
            </span>
          </div>
          {viewTabs}
          <div className="panel-tools">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | ContainerStatus)} aria-label="Filter by state">
              <option value="">Every state</option>
              <option value="loading">Loading</option>
              <option value="shipped">Shipped</option>
              <option value="arrived">Arrived</option>
            </select>
            <select value={destinationFilter} onChange={(e) => setDestinationFilter(e.target.value)} aria-label="Filter by destination">
              <option value="">Every destination</option>
              {destinationFilterOptions.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
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
                    // A container opens its detail; a waiting package opens the waiting list.
                    const open = () => {
                      if (containerId) setSelectedId(containerId);
                      else if (hit.waiting) { setSearch(""); setView("waiting"); }
                    };
                    return (
                      <div
                        className="mini-table-row ctn-clickable"
                        key={String(hit.line.id)}
                        role="button"
                        tabIndex={0}
                        onClick={open}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
                      >
                        <span><strong data-no-translate>{title}</strong>{vin && vin !== title && <small data-no-translate>{vin}</small>}{vin && <CopyValue value={vin} label="Copy VIN" />}<LineTrackingCode code={text(hit.line.trackingCode, "")} /></span>
                        <span>
                          {stock ? <strong>Business stock</strong> : <strong data-no-translate>{text(hit.line.customerName, "")}</strong>}
                          {!stock && <small data-no-translate>{text(hit.line.customerPhone, "")}</small>}
                          <LineWhatsApp line={hit.line} />
                        </span>
                        <span>
                          {hit.container ? <strong data-no-translate>{containerTitle(hit.container)}</strong> : hit.waiting ? <strong>Waiting for a container</strong> : <strong>—</strong>}
                          {hit.container && <small>{destinationLabel(hit.container)}</small>}
                          {hit.waiting && Boolean(text(hit.line.destinationCountryName, "")) && <small>{destinationLabel(hit.line)}</small>}
                        </span>
                        <span className="ctn-hit-state">
                          <span><StatusBadge status={hit.status} />{Boolean(hit.sailedAt) && <small>{formatDate(hit.sailedAt)}</small>}</span>
                          {containerId && (
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={busy}
                              title="Print labels"
                              aria-label="Print labels"
                              // The row opens the container; this button must not.
                              onClick={(e) => { e.stopPropagation(); openLabels(containerId, hit.line); }}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <Tag size={14} />
                            </button>
                          )}
                        </span>
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
                      <span><strong data-no-translate>{containerTitle(row)}</strong>{number && <small data-no-translate>{text(row.label, "")}</small>}</span>
                      <span><strong>{destinationLabel(row) || "—"}</strong>{text(row.bookingReference, "") && <small data-no-translate>{text(row.bookingReference, "")}</small>}</span>
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
          {!searching && (statusFilter === "" || statusFilter === "arrived") && (
            <LoadMoreButton
              hasMore={arrivedContainers.hasMore}
              loading={arrivedContainers.loadingMore}
              onLoadMore={arrivedContainers.loadMore}
            />
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
                    <label className="lst-field wide"><span>Working name</span><input value={containerDraft.label} onChange={(e) => setContainerDraft((d) => ({ ...d, label: e.target.value }))} placeholder="Sailing 3 Oct, box 2" /><small className="lst-hint">Optional once there is a container or booking number.</small></label>
                    <label className="lst-field"><span>Container number</span><input value={containerDraft.containerNumber} onChange={(e) => setContainerDraft((d) => ({ ...d, containerNumber: e.target.value.toUpperCase() }))} placeholder="e.g. MSKU1234567" /><small className="lst-hint">Four letters and seven digits, when the shipping line sends it.</small></label>
                    <label className="lst-field"><span>Booking / BL reference</span><input value={containerDraft.bookingReference} onChange={(e) => setContainerDraft((d) => ({ ...d, bookingReference: e.target.value }))} /></label>
                    <label className="lst-field wide"><span>Destination</span>
                      <select value={containerDraft.destinationCountryId} onChange={(e) => pickDestination(e.target.value)}>
                        <option value="">Not chosen yet</option>
                        {containerDraft.destinationCountryId && !destinationOptions.all.some((o) => o.id === containerDraft.destinationCountryId) && (
                          <option value={containerDraft.destinationCountryId}>{containerDraft.destinationCountryName || containerDraft.destinationCountryId}</option>
                        )}
                        {destinationOptions.own.length > 0 ? (
                          <>
                            <optgroup label="Your destinations">
                              {destinationOptions.own.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
                            </optgroup>
                            <optgroup label="Every other country">
                              {destinationOptions.rest.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
                            </optgroup>
                          </>
                        ) : (
                          destinationOptions.rest.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))
                        )}
                      </select>
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
              <div><h3>{editingLineId ? "Edit line" : "Add a line"}</h3><p><span data-no-translate>{containerTitle(selected)}</span> — what went in, and whose it is.</p></div>
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
              {addedThisSitting.length > 0 && (
                <p className="lst-hint" role="status">Added so far: <span data-no-translate>{addedThisSitting.join("; ")}</span>.</p>
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
                  <ContactPhone
                    id="ctn-customer-phone"
                    label="Phone"
                    value={lineDraft.customerPhone}
                    onChange={(value) => setLineDraft((d) => ({ ...d, customerPhone: value }))}
                    notify={lineDraft.notifyCustomer}
                    onNotify={(value) => setLineDraft((d) => ({ ...d, notifyCustomer: value }))}
                    initialCountryCode={customerPhoneCountry}
                  />
                </div>
              )}
              {ownerVisible && (
                <div className="lst-form-grid">
                  <label className="lst-field"><span>Receiver at destination</span><input value={lineDraft.receiverName} placeholder="The name written on it" onChange={(e) => setLineDraft((d) => ({ ...d, receiverName: e.target.value }))} /></label>
                  <ContactPhone
                    id="ctn-receiver-phone"
                    label="Receiver's phone"
                    value={lineDraft.receiverPhone}
                    onChange={(value) => setLineDraft((d) => ({ ...d, receiverPhone: value }))}
                    notify={lineDraft.notifyReceiver}
                    onNotify={(value) => setLineDraft((d) => ({ ...d, notifyReceiver: value }))}
                    initialCountryCode={receiverPhoneCountry}
                  />
                </div>
              )}
              {ownerVisible && lineDraft.kind !== "car" && !editingLineId && (
                <p className="lst-hint">Several customers' barrels in one go? Save each customer's share and add the next.</p>
              )}
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              {ownerVisible && lineDraft.kind !== "car" && !editingLineId && (
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void saveLine(true)}>Save & add another</button>
              )}
              <button className="lst-add" type="button" disabled={busy || !ownerVisible} aria-busy={busy} onClick={() => void saveLine()}>
                {busy ? <RefreshCw className="spin" size={16} /> : editingLineId ? null : <Plus size={16} />}
                {busy ? "Saving..." : editingLineId ? "Save line" : (addedThisSitting.length > 0 ? "Add & close" : "Add line")}
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

      {modal === "contacts" && contactsLine && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Edit contacts</h3><p>{containerLineTitle(contactsLine)} — who it belongs to, who collects it, and who hears about it.</p></div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <p className="lst-hint">Names and phone numbers can be corrected at any time, even after the container has sailed.</p>
              {!containerLineIsStock(contactsLine) && (
                <div className="lst-form-grid">
                  <label className="lst-field"><span>Customer</span>
                    <input value={contactsDraft.customerName} autoComplete="off" onChange={(e) => setContactsDraft((d) => ({ ...d, customerName: e.target.value }))} />
                  </label>
                  <ContactPhone
                    id="ctn-contacts-customer-phone"
                    label="Phone"
                    value={contactsDraft.customerPhone}
                    onChange={(value) => setContactsDraft((d) => ({ ...d, customerPhone: value }))}
                    notify={contactsDraft.notifyCustomer}
                    onNotify={(value) => setContactsDraft((d) => ({ ...d, notifyCustomer: value }))}
                    initialCountryCode={customerPhoneCountry}
                    disabled={busy}
                  />
                </div>
              )}
              <div className="lst-form-grid">
                <label className="lst-field"><span>Receiver at destination</span>
                  <input value={contactsDraft.receiverName} placeholder="The name written on it" onChange={(e) => setContactsDraft((d) => ({ ...d, receiverName: e.target.value }))} />
                </label>
                <ContactPhone
                  id="ctn-contacts-receiver-phone"
                  label="Receiver's phone"
                  value={contactsDraft.receiverPhone}
                  onChange={(value) => setContactsDraft((d) => ({ ...d, receiverPhone: value }))}
                  notify={contactsDraft.notifyReceiver}
                  onNotify={(value) => setContactsDraft((d) => ({ ...d, notifyReceiver: value }))}
                  initialCountryCode={contactsLineContainer ? phoneCountryForDestination(contactsLineContainer, customerPhoneCountry, destinations.rows) : customerPhoneCountry}
                  disabled={busy}
                />
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void saveContacts()}>
                {busy ? <RefreshCw className="spin" size={16} /> : null}
                {busy ? "Saving..." : "Save contacts"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === "assign" && selected && (
        <AddWaitingPackagesDialog
          businessId={businessId}
          container={selected}
          packages={waiting.rows}
          onClose={closeModal}
          onAssigned={setFlash}
        />
      )}

      {modal === "labels" && labelsContainer && (
        <ContainerLabelsDialog
          businessId={businessId}
          container={labelsContainer}
          line={labelsLine}
          onClose={closeModal}
        />
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
                    {text(h.summary, "") && <div style={{ marginTop: 2 }}><small data-audit-summary>{text(h.summary, "")}</small></div>}
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
    line_contacts_edited: "Contacts edited",
    line_edited: "Line changed",
    shipped: "Shipped",
    arrived: "Arrived",
    deleted: "Deleted",
  };
  return labels[action] ?? "Changed";
}
